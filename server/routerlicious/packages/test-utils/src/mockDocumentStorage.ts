/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import type {
	IDocument,
	IDocumentDetails,
	IDocumentStorage,
} from "@fluidframework/server-services-core";

/**
 * Minimal in-memory implementation of IDocumentStorage for tests that only need getDocument behavior.
 * All other methods throw by default to surface unintended usage.
 *
 * @remarks
 * Prefer this over the heavier {@link TestDocumentStorage} when tests only interact with getDocument.
 */
export interface IMockDocumentStorageControls {
	set(doc: IDocument): void;
	remove(tenantId: string, documentId: string): void;
	clear(): void;
	/** Direct access to underlying map for advanced cases */
	readonly docs: Map<string, IDocument>;
}

/**
 * Factory returning a lightweight mock IDocumentStorage plus mutation helpers.
 */
export function createMockDocumentStorage(initialDocs: IDocument[] = []): {
	storage: IDocumentStorage;
	controls: IMockDocumentStorageControls;
} {
	const docs = new Map<string, IDocument>();
	for (const d of initialDocs) {
		docs.set(key(d.tenantId, d.documentId), d);
	}

	function key(tenantId: string, documentId: string) {
		return `${tenantId}::${documentId}`;
	}

	const storage: IDocumentStorage = {
		// Only method currently required by api.spec.ts
		async getDocument(tenantId: string, documentId: string): Promise<IDocument | null> {
			return docs.get(key(tenantId, documentId)) ?? null;
		},
		// Minimal createDocument implementation: records a placeholder doc; ignores summary/tree semantics
		async createDocument(
			tenantId: string,
			documentId: string,
			// summary, sequenceNumber, initialHash, ordererUrl, historianUrl, deltaStreamUrl, values, enableDiscovery, isEphemeral, messageBrokerId
			..._rest: any[]
		): Promise<IDocumentDetails> {
			const existing = docs.get(key(tenantId, documentId));
			if (!existing) {
				const newDoc: IDocument = {
					_id: documentId,
					documentId,
					tenantId,
					createTime: Date.now(),
					version: "0.1",
					// Provide empty session; route logic may patch or read it
					session: {
						ordererUrl: "",
						deltaStreamUrl: "",
						historianUrl: "",
						isSessionAlive: false,
						isSessionActive: false,
					},
					// Optional props the real implementation includes; keep empty
					deli: "",
					scribe: "",
				} as any;
				docs.set(key(tenantId, documentId), newDoc);
				return { value: newDoc, existing: false } as unknown as IDocumentDetails;
			}
			return { value: existing, existing: true } as unknown as IDocumentDetails;
		},
		async getOrCreateDocument(tenantId: string, documentId: string): Promise<IDocumentDetails> {
			const doc = await this.getDocument(tenantId, documentId);
			if (doc) {
				return { value: doc, existing: true } as unknown as IDocumentDetails;
			}
			// Provide placeholder args to satisfy signature: summary, seq, initialHash, ordererUrl, historianUrl,
			// deltaStreamUrl, values, enableDiscovery, isEphemeral, messageBrokerId
			return this.createDocument(
				tenantId,
				documentId,
				{ type: 1 as any, tree: {} },
				0,
				"hash",
				"orderer",
				"historian",
				"delta",
				[],
				false,
				false,
				undefined,
			);
		},
		async getLatestVersion(): Promise<any> {
			throw new Error("getLatestVersion not implemented in mock");
		},
		async getVersions(): Promise<any[]> {
			throw new Error("getVersions not implemented in mock");
		},
		async getVersion(): Promise<any> {
			throw new Error("getVersion not implemented in mock");
		},
		async getFullTree(): Promise<any> {
			throw new Error("getFullTree not implemented in mock");
		},
	};

	const controls: IMockDocumentStorageControls = {
		set(doc: IDocument) {
			docs.set(key(doc.tenantId, doc.documentId), doc);
		},
		remove(tenantId: string, documentId: string) {
			docs.delete(key(tenantId, documentId));
		},
		clear() {
			docs.clear();
		},
		get docs() {
			return docs;
		},
	};

	return { storage, controls };
}
