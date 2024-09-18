/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { handleResponse } from "@fluidframework/server-services-shared";
import { Router } from "express";
import nconf from "nconf";
import { Lumberjack } from "@fluidframework/server-services-telemetry";
import { NetworkError } from "@fluidframework/server-services-client";
import {
	checkSoftDeleted,
	getExternalWriterParams,
	getFilesystemManagerFactory,
	getGitManagerFactoryParamsFromConfig,
	spoofLazyRepoInitialCommit,
	getLumberjackBasePropertiesFromRepoManagerParams,
	getRepoManagerParamsFromRequest,
	IFileSystemManagerFactories,
	IRepositoryManagerFactory,
	isRepoNotExistsError,
	logAndThrowApiError,
	retrieveLazyRepoSummary,
} from "../../utils";

export function create(
	store: nconf.Provider,
	fileSystemManagerFactories: IFileSystemManagerFactories,
	repoManagerFactory: IRepositoryManagerFactory,
): Router {
	const router: Router = Router();
	const { storageDirectoryConfig, repoPerDocEnabled } =
		getGitManagerFactoryParamsFromConfig(store);
	const lazyRepoInitCompatEnabled: boolean = store.get("git:enableLazyRepoInitCompat") ?? false;

	// https://developer.github.com/v3/repos/commits/
	// sha
	// path
	// author
	// since
	// until

	// eslint-disable-next-line @typescript-eslint/no-misused-promises
	router.get("/repos/:owner/:repo/commits", async (request, response, next) => {
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
				return repoManager.getCommits(
					request.query.sha as string,
					Number(request.query.count as string),
					getExternalWriterParams(request.query?.config as string),
				);
			})
			.catch(async (error) => {
				if (!(lazyRepoInitCompatEnabled && isRepoNotExistsError(error))) {
					// A Lazy Repo will always throw a repo not exists error if only the first summary
					// has been written. In this case, we can try to retrieve the lazy repo summary
					// and return a spoofed first commit.
					try {
						const lazyRepoSummary = await retrieveLazyRepoSummary(
							fileSystemManagerFactories,
							repoManagerParams,
							{ storageDirectoryConfig, repoPerDocEnabled },
						);
						if (lazyRepoSummary?.trees[0]?.id === undefined) {
							throw new NetworkError(404, "No latest full summary found");
						}
						// If we have a lazy repo, we can return a dummy commit
						return [
							spoofLazyRepoInitialCommit(lazyRepoSummary.trees[0].id, repoManagerParams),
						];
					} catch (lazyRepoRecoveryError: unknown) {
						const lumberjackProperties = {
							...getLumberjackBasePropertiesFromRepoManagerParams(repoManagerParams),
						};
						// If this should be a lazy repo but we failed to retrieve the summary,
						// log the error and continue to throw the original error.
						Lumberjack.warning(
							"Failed to spoof commits for possible lazy repo",
							lumberjackProperties,
							lazyRepoRecoveryError,
						);
					}
				}
				logAndThrowApiError(error, request, repoManagerParams);
			});
		handleResponse(resultP, response);
	});

	return router;
}
