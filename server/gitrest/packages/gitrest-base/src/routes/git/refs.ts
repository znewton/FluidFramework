/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import {
	ICreateRefParamsExternal,
	IPatchRefParamsExternal,
	NetworkError,
} from "@fluidframework/server-services-client";
import { handleResponse } from "@fluidframework/server-services-shared";
import { Lumberjack } from "@fluidframework/server-services-telemetry";
import { Router } from "express";
import nconf from "nconf";
import {
	checkSoftDeleted,
	getExternalWriterParams,
	getFilesystemManagerFactory,
	getGitManagerFactoryParamsFromConfig,
	getLumberjackBasePropertiesFromRepoManagerParams,
	getRepoManagerFromWriteAPI,
	getRepoManagerParamsFromRequest,
	IFileSystemManagerFactories,
	IRepositoryManagerFactory,
	isRepoNotExistsError,
	logAndThrowApiError,
	retrieveLazyRepoSummary,
	spoofLazyRepoRef,
} from "../../utils";

/**
 * Simple method to convert from a path id to the git reference ID
 */
export function getRefId(id: string): string {
	return `refs/${id}`;
}

export function create(
	store: nconf.Provider,
	fileSystemManagerFactories: IFileSystemManagerFactories,
	repoManagerFactory: IRepositoryManagerFactory,
): Router {
	const router: Router = Router();
	const { storageDirectoryConfig, repoPerDocEnabled } =
		getGitManagerFactoryParamsFromConfig(store);
	const lazyRepoInitCompatEnabled: boolean = store.get("git:enableLazyRepoInitCompat") ?? false;

	// https://developer.github.com/v3/git/refs/

	// eslint-disable-next-line @typescript-eslint/no-misused-promises
	router.get("/repos/:owner/:repo/git/refs", async (request, response, next) => {
		const repoManagerParams = getRepoManagerParamsFromRequest(request);
		const resultP = repoManagerFactory
			.open(repoManagerParams)
			.then(async (repoManager) => {
				const fileSystemManagerFactory = getFilesystemManagerFactory(
					fileSystemManagerFactories,
					repoManagerParams.isEphemeralContainer,
				);
				const fsManager = fileSystemManagerFactory.create({
					...repoManagerParams.fileSystemManagerParams,
					rootDir: repoManager.path,
				});
				await checkSoftDeleted(
					fsManager,
					repoManager.path,
					repoManagerParams,
					repoPerDocEnabled,
				);
				return repoManager.getRefs();
			})
			.catch((error) => logAndThrowApiError(error, request, repoManagerParams));
		handleResponse(resultP, response);
	});

	// eslint-disable-next-line @typescript-eslint/no-misused-promises
	router.get("/repos/:owner/:repo/git/refs/*", async (request, response, next) => {
		const repoManagerParams = getRepoManagerParamsFromRequest(request);
		const refId = getRefId(request.params[0]);
		const resultP = repoManagerFactory
			.open(repoManagerParams)
			.then(async (repoManager) => {
				const fileSystemManagerFactory = getFilesystemManagerFactory(
					fileSystemManagerFactories,
					repoManagerParams.isEphemeralContainer,
				);
				const fsManager = fileSystemManagerFactory.create({
					...repoManagerParams.fileSystemManagerParams,
					rootDir: repoManager.path,
				});
				await checkSoftDeleted(
					fsManager,
					repoManager.path,
					repoManagerParams,
					repoPerDocEnabled,
				);
				return repoManager.getRef(
					refId,
					getExternalWriterParams(request.query?.config as string),
				);
			})
			.catch(async (error) => {
				if (!(lazyRepoInitCompatEnabled && isRepoNotExistsError(error))) {
					// A Lazy Repo will always throw a repo not exists error if only the first summary
					// has been written. In this case, we can try to retrieve the lazy repo summary
					// and return a spoofed ref.
					try {
						// Note: This could probably be optimized to only check if
						// the summary exists instead of retrieving it.
						const lazyRepoSummary = await retrieveLazyRepoSummary(
							fileSystemManagerFactories,
							repoManagerParams,
							{ storageDirectoryConfig, repoPerDocEnabled },
						);
						if (lazyRepoSummary?.trees[0]?.id === undefined) {
							throw new NetworkError(404, "No latest full summary found");
						}
						// If we have a lazy repo, we can return a dummy commit
						return spoofLazyRepoRef(refId, repoManagerParams);
					} catch (lazyRepoRecoveryError: unknown) {
						const lumberjackProperties = {
							...getLumberjackBasePropertiesFromRepoManagerParams(repoManagerParams),
						};
						// If this should be a lazy repo but we failed to retrieve the summary,
						// log the error and continue to throw the original error.
						Lumberjack.warning(
							"Failed to spoof ref for lazy repo",
							lumberjackProperties,
							lazyRepoRecoveryError,
						);
					}
				}
				logAndThrowApiError(error, request, repoManagerParams);
			});
		handleResponse(resultP, response);
	});

	// eslint-disable-next-line @typescript-eslint/no-misused-promises
	router.post("/repos/:owner/:repo/git/refs", async (request, response, next) => {
		const repoManagerParams = getRepoManagerParamsFromRequest(request);
		const createRefParams = request.body as ICreateRefParamsExternal;
		const resultP = getRepoManagerFromWriteAPI(
			repoManagerFactory,
			repoManagerParams,
			repoPerDocEnabled,
		)
			.then(async ({ repoManager }) => {
				const fileSystemManagerFactory = getFilesystemManagerFactory(
					fileSystemManagerFactories,
					repoManagerParams.isEphemeralContainer,
				);
				const fsManager = fileSystemManagerFactory.create({
					...repoManagerParams.fileSystemManagerParams,
					rootDir: repoManager.path,
				});
				await checkSoftDeleted(
					fsManager,
					repoManager.path,
					repoManagerParams,
					repoPerDocEnabled,
				);
				return repoManager.createRef(createRefParams, createRefParams.config);
			})
			.catch((error) => logAndThrowApiError(error, request, repoManagerParams));
		handleResponse(resultP, response, undefined, undefined, 201);
	});

	// eslint-disable-next-line @typescript-eslint/no-misused-promises
	router.patch("/repos/:owner/:repo/git/refs/*", async (request, response, next) => {
		const repoManagerParams = getRepoManagerParamsFromRequest(request);
		const patchRefParams = request.body as IPatchRefParamsExternal;
		const resultP = getRepoManagerFromWriteAPI(
			repoManagerFactory,
			repoManagerParams,
			repoPerDocEnabled,
		)
			.then(async ({ repoManager }) => {
				const fileSystemManagerFactory = getFilesystemManagerFactory(
					fileSystemManagerFactories,
					repoManagerParams.isEphemeralContainer,
				);
				const fsManager = fileSystemManagerFactory.create({
					...repoManagerParams.fileSystemManagerParams,
					rootDir: repoManager.path,
				});
				await checkSoftDeleted(
					fsManager,
					repoManager.path,
					repoManagerParams,
					repoPerDocEnabled,
				);
				return repoManager.patchRef(
					getRefId(request.params[0]),
					patchRefParams,
					patchRefParams.config,
				);
			})
			.catch((error) => logAndThrowApiError(error, request, repoManagerParams));
		handleResponse(resultP, response);
	});

	// eslint-disable-next-line @typescript-eslint/no-misused-promises
	router.delete("/repos/:owner/:repo/git/refs/*", async (request, response, next) => {
		const repoManagerParams = getRepoManagerParamsFromRequest(request);
		const resultP = repoManagerFactory
			.open(repoManagerParams)
			.then(async (repoManager) => {
				const fileSystemManagerFactory = getFilesystemManagerFactory(
					fileSystemManagerFactories,
					repoManagerParams.isEphemeralContainer,
				);
				const fsManager = fileSystemManagerFactory.create({
					...repoManagerParams.fileSystemManagerParams,
					rootDir: repoManager.path,
				});
				await checkSoftDeleted(
					fsManager,
					repoManager.path,
					repoManagerParams,
					repoPerDocEnabled,
				);
				return repoManager.deleteRef(getRefId(request.params[0]));
			})
			.catch((error) => logAndThrowApiError(error, request, repoManagerParams));
		handleResponse(resultP, response, undefined, undefined, 204);
	});
	return router;
}
