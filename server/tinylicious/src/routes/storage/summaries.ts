/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { ICreateBlobParams, ICreateTreeParams } from "@fluidframework/gitresources";
import {
    IWholeFlatSummary,
    IWholeSummaryPayload,
    IWriteSummaryResponse,
    NetworkError,
} from "@fluidframework/server-services-client";
import { WholeSummaryReadGitManager, WholeSummaryWriteGitManager } from "@fluidframework/server-services-shared";
import { Router } from "express";
import nconf from "nconf";
import winston from "winston";
import { createBlob, getBlob } from "./git/blobs";
import { createTree, getTree } from "./git/trees";
import { getCommits } from "./repository/commits";
import { handleResponse, parseAuthToken } from "./utils";

export async function getSummary(
    store: nconf.Provider,
    tenantId: string,
    authorizationHeader: string,
    sha: string,
    documentId: string,
    useCache: boolean): Promise<IWholeFlatSummary> {
    const getLatestDocumentVersion = async () => {
        const versions = await getCommits(
            store,
            tenantId,
            authorizationHeader,
            documentId,
            1,
        );
        if (!versions || versions.length === 0) {
            throw new NetworkError(404, "No latest version found for document");
        }
        winston.info("LATEST VERSION", { documentId, latestVersion: versions[0].commit.tree.sha });
        return versions[0].commit.tree.sha;
    };
    const readBlob = async (blobSha: string) => {
        return getBlob(
            store,
            tenantId,
            authorizationHeader,
            blobSha,
            useCache);
    };
    const readTreeRecursive = async (treeSha: string) => {
        return getTree(
            store,
            tenantId,
            authorizationHeader,
            treeSha,
            true,
            useCache);
    };
    const wholeSummaryReadGitManager = new WholeSummaryReadGitManager(
        getLatestDocumentVersion,
        readBlob,
        readTreeRecursive,
    );
    return wholeSummaryReadGitManager.readSummary(sha);
}

export async function createSummary(
    store: nconf.Provider,
    tenantId: string,
    authorizationHeader: string,
    payload: IWholeSummaryPayload): Promise<IWriteSummaryResponse> {
    const writeBlob = async (blob: ICreateBlobParams) => {
        const blobResponse = await createBlob(
            store,
            tenantId,
            authorizationHeader,
            blob,
        );
        return blobResponse.sha;
    };
    const writeTree = async (tree: ICreateTreeParams) => {
        const treeHandle = await createTree(
            store,
            tenantId,
            authorizationHeader,
            tree,
        );
        return treeHandle.sha;
    };
    const wholeSummaryWriteGitManager = new WholeSummaryWriteGitManager(writeBlob, writeTree);
    const summaryHandle = await wholeSummaryWriteGitManager.writeSummary(payload);
    return { id: summaryHandle };
}

export async function deleteSummary(
    store: nconf.Provider,
    tenantId: string,
    authorizationHeader: string,
    softDelete: boolean): Promise<boolean> {
    throw new NetworkError(501, "Not Implemented");
}

export function create(store: nconf.Provider): Router {
    const router: Router = Router();

    /**
     * Retrieves a summary.
     * If sha is "latest", returns latest summary for owner/repo.
     */
     router.get("/repos/:ignored?/:tenantId/git/summaries/:sha", (request, response) => {
        const useCache = !("disableCache" in request.query);
        const tenantId = request.params.tenantId;
        const authorizationHeader: string = request.get("Authorization");
        if (!authorizationHeader) {
            handleResponse(Promise.reject(new NetworkError(400, "Missing Authorization header")), response);
            return;
        }
        const authToken = parseAuthToken(tenantId, authorizationHeader);
        if (!authToken || !authToken.documentId) {
            handleResponse(Promise.reject(new NetworkError(400, "Invalid Storage-Routing-Id header")), response);
            return;
        }
        winston.info("GET SUMMARY", { tenantId, documentId: authToken.documentId, sha: request.params.sha});
        handleResponse(
            getSummary(
                store,
                tenantId,
                authorizationHeader,
                request.params.sha,
                authToken.documentId,
                useCache),
            response,
        );
    });

    /**
     * Creates a new summary.
     */
    router.post("/repos/:ignored?/:tenantId/git/summaries", (request, response) => {
        const wholeSummaryPayload: IWholeSummaryPayload = request.body;
        handleResponse(
            createSummary(
                store,
                request.params.tenantId,
                request.get("Authorization"),
                wholeSummaryPayload),
            response,
            undefined,
            201,
        );
    });

    /**
     * Deletes the latest summary for the owner/repo.
     * If header Soft-Delete="true", only flags summary as deleted.
     */
    router.delete("/repos/:ignored?/:tenantId/git/summaries/:sha", (request, response) => {
        const softDelete = request.get("Soft-Delete")?.toLowerCase() === "true";
        handleResponse(
            deleteSummary(
                store,
                request.params.tenantId,
                request.get("Authorization"),
                softDelete),
            response,
        );
    });

    return router;
}
