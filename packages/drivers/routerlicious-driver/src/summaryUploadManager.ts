/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { ITelemetryLogger } from "@fluidframework/common-definitions";
import { assert, gitHashFile, IsoBuffer, Uint8ArrayToString, unreachableCase } from "@fluidframework/common-utils";
import { ISummaryContext } from "@fluidframework/driver-definitions";
import { ICreateTreeEntry } from "@fluidframework/gitresources";
import { getGitMode, getGitType } from "@fluidframework/protocol-base";
import {
    ISnapshotTreeEx,
    ISummaryTree,
    SummaryObject,
    SummaryType,
} from "@fluidframework/protocol-definitions";
import type { GitManager } from "@fluidframework/server-services-client";
import { PerformanceEvent } from "@fluidframework/telemetry-utils";
import * as summaryContract from "./contracts";

export interface ISummaryUploadManager {
    /**
     * Writes summary tree to storage.
     * @returns id of created tree.
     */
    writeSummaryTree(summaryTree: ISummaryTree, context: ISummaryContext): Promise<string>;
}

/**
 * Recursively writes summary tree as individual summary blobs.
 */
export class SummaryTreeUploadManager implements ISummaryUploadManager {
    constructor(
        private readonly manager: GitManager,
        private readonly blobsShaCache: Map<string, string>,
        private readonly getPreviousFullSnapshot:
            (context: ISummaryContext) => Promise<ISnapshotTreeEx | null | undefined>,
    ) {
    }

    public async writeSummaryTree(
        summaryTree: ISummaryTree,
        context: ISummaryContext,
    ): Promise<string> {
        const previousFullSnapshot = await this.getPreviousFullSnapshot(context);
        return this.writeSummaryTreeCore(summaryTree, previousFullSnapshot ?? undefined);
    }

    private async writeSummaryTreeCore(
        summaryTree: ISummaryTree,
        previousFullSnapshot: ISnapshotTreeEx | undefined,
    ): Promise<string> {
        const entries = await Promise.all(Object.keys(summaryTree.tree).map(async (key) => {
            const entry = summaryTree.tree[key];
            const pathHandle = await this.writeSummaryTreeObject(key, entry, previousFullSnapshot);
            const treeEntry: ICreateTreeEntry = {
                mode: getGitMode(entry),
                path: encodeURIComponent(key),
                sha: pathHandle,
                type: getGitType(entry),
            };
            return treeEntry;
        }));

        const treeHandle = await this.manager.createGitTree({ tree: entries });
        return treeHandle.sha;
    }

    private async writeSummaryTreeObject(
        key: string,
        object: SummaryObject,
        previousFullSnapshot: ISnapshotTreeEx | undefined,
        currentPath = "",
    ): Promise<string> {
        switch (object.type) {
            case SummaryType.Blob: {
                return this.writeSummaryBlob(object.content);
            }
            case SummaryType.Handle: {
                if (previousFullSnapshot === undefined) {
                    throw Error("Parent summary does not exist to reference by handle.");
                }
                return this.getIdFromPath(object.handleType, object.handle, previousFullSnapshot);
            }
            case SummaryType.Tree: {
                return this.writeSummaryTreeCore(object, previousFullSnapshot);
            }
            case SummaryType.Attachment: {
                return object.id;
            }

            default:
                unreachableCase(object, `Unknown type: ${(object as any).type}`);
        }
    }

    private async writeSummaryBlob(content: string | Uint8Array): Promise<string> {
        const { parsedContent, encoding } = typeof content === "string"
            ? { parsedContent: content, encoding: "utf-8" }
            : { parsedContent: Uint8ArrayToString(content, "base64"), encoding: "base64" };

        // The gitHashFile would return the same hash as returned by the server as blob.sha
        const hash = await gitHashFile(IsoBuffer.from(parsedContent, encoding));
        if (!this.blobsShaCache.has(hash)) {
            this.blobsShaCache.set(hash, "");
            const blob = await this.manager.createBlob(parsedContent, encoding);
            assert(hash === blob.sha, 0x0b6 /* "Blob.sha and hash do not match!!" */);
        }
        return hash;
    }

    private getIdFromPath(
        handleType: SummaryType,
        handlePath: string,
        previousFullSnapshot: ISnapshotTreeEx,
    ): string {
        const path = handlePath.split("/").map((part) => decodeURIComponent(part));
        if (path[0] === "") {
            // root of tree should be unnamed
            path.shift();
        }
        if (path.length === 0) {
            return previousFullSnapshot.id;
        }

        return this.getIdFromPathCore(handleType, path, previousFullSnapshot);
    }

    private getIdFromPathCore(
        handleType: SummaryType,
        path: string[],
        /** Previous snapshot, subtree relative to this path part */
        previousSnapshot: ISnapshotTreeEx,
    ): string {
        assert(path.length > 0, 0x0b3 /* "Expected at least 1 path part" */);
        const key = path[0];
        if (path.length === 1) {
            switch (handleType) {
                case SummaryType.Blob: {
                    const tryId = previousSnapshot.blobs[key];
                    assert(!!tryId, 0x0b4 /* "Parent summary does not have blob handle for specified path." */);
                    return tryId;
                }
                case SummaryType.Tree: {
                    const tryId = previousSnapshot.trees[key]?.id;
                    assert(!!tryId, 0x0b5 /* "Parent summary does not have tree handle for specified path." */);
                    return tryId;
                }
                default:
                    throw Error(`Unexpected handle summary object type: "${handleType}".`);
            }
        }
        return this.getIdFromPathCore(handleType, path.slice(1), previousSnapshot.trees[key]);
    }
}

/**
 * Converts summary to snapshot tree and uploads with single snaphot tree payload.
 */
export class SnapshotTreeUploadManager implements ISummaryUploadManager {
    constructor(
        private readonly manager: GitManager,
        private readonly logger: ITelemetryLogger,
    ) {
    }

    public async writeSummaryTree(
        summaryTree: ISummaryTree,
        context: ISummaryContext,
    ): Promise<string> {
        const id = await this.writeSummaryTreeCore(context.ackHandle, summaryTree);
        if (!id) {
            throw new Error(`Failed to write summary tree`);
        }
        return id;
    }

    private async writeSummaryTreeCore(
        parentHandle: string | undefined,
        tree: ISummaryTree,
    ): Promise<string> {
        const { snapshotTree, blobs } = await this.convertSummaryToSnapshotTree(
            parentHandle,
            tree,
            "",
        );
        const snapshotPayload: summaryContract.ISummarySnapshotPayload = {
            entries: snapshotTree.entries!,
            type: summaryContract.SummarySnapshotType.Channel,
        };

        return PerformanceEvent.timedExecAsync(this.logger,
            {
                eventName: "uploadSummary",
                blobs,
            },
            // TODO: Replace with GitManager.createSummary()
            async () => this.manager.createBlob(JSON.stringify(snapshotPayload), "utf8")
                .then((response) => response.sha),
        );
    }
    /**
     * Converts the summary tree to a snapshot tree to be uploaded. Always upload full snapshot tree.
     * @param parentHandle - Handle of the last uploaded summary or detach new summary.
     * @param tree - Summary Tree which will be converted to snapshot tree to be uploaded.
     * @param path - Current path of node which is getting evaluated.
     */
     private async convertSummaryToSnapshotTree(
        parentHandle: string | undefined,
        tree: ISummaryTree,
        path: string = "",
    ): Promise<{ snapshotTree: summaryContract.ISummarySnapshotTree; blobs: number }> {
        const snapshotTree: summaryContract.ISummarySnapshotTree = {
            type: "tree",
            entries: [] as summaryContract.SummarySnapshotTreeEntry[],
        };

        let blobs = 0;

        const keys = Object.keys(tree.tree);
        for (const key of keys) {
            const summaryObject = tree.tree[key];

            let id: string | undefined;
            let value: summaryContract.SummarySnapshotTreeValue | undefined;

            const currentPath = path === "" ? key : `${path}/${key}`;
            switch (summaryObject.type) {
                case SummaryType.Tree: {
                    const result = await this.convertSummaryToSnapshotTree(
                        parentHandle,
                        summaryObject,
                        currentPath);
                    value = result.snapshotTree;
                    break;
                }
                case SummaryType.Blob: {
                    if (typeof summaryObject.content === "string") {
                        value = {
                            type: "blob",
                            content: summaryObject.content,
                            encoding: "utf-8",
                        };
                    } else {
                        value = {
                            type: "blob",
                            content: Uint8ArrayToString(summaryObject.content, "base64"),
                            encoding: "base64",
                        };
                    }
                    blobs++;
                    break;
                }
                case SummaryType.Handle: {
                    if (!parentHandle) {
                        throw Error("Parent summary does not exist to reference by handle.");
                    }
                    id = `${parentHandle}/${summaryObject.handle}`;
                    break;
                }
                case SummaryType.Attachment: {
                    id = summaryObject.id;
                    break;
                }
                default: {
                    unreachableCase(summaryObject, `Unknown type: ${(summaryObject as any).type}`);
                }
            }

            const baseEntry: summaryContract.ISummarySnapshotTreeBaseEntry = {
                path: encodeURIComponent(key),
                type: getGitType(summaryObject),
            };

            let entry: summaryContract.SummarySnapshotTreeEntry;

            if (value) {
                assert(id === undefined, 0x0ad /* "Snapshot entry has both a tree value and a referenced id!" */);
                entry = {
                    value,
                    ...baseEntry,
                };
            } else if (id) {
                entry = {
                    ...baseEntry,
                    id,
                };
            } else {
                throw new Error(`Invalid tree entry for ${summaryObject.type}`);
            }

            snapshotTree.entries!.push(entry);
        }

        return { snapshotTree, blobs };
    }
}
