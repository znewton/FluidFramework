import type { ICommitDetails, IRef } from "@fluidframework/gitresources";
import {
	getFilesystemManagerFactory,
	getLatestFullSummaryDirectory,
	getLumberjackBasePropertiesFromRepoManagerParams,
	getRepoInfoFromParamsAndStorageConfig,
	retrieveLatestFullSummaryFromStorage,
	WholeSummaryConstants,
	type IFileSystemManagerFactories,
	type IRepoManagerParams,
} from ".";
import type { IWholeFlatSummary } from "@fluidframework/server-services-client";
import type { IGitManagerFactoryParams } from "./helpers";

export function spoofLazyRepoRef(refId: string, repoManagerParams: IRepoManagerParams): IRef {
	return {
		ref: refId,
		url: `/repos/${repoManagerParams.repoOwner}/${repoManagerParams.repoName}/git/refs/${refId}`,
		object: {
			sha: WholeSummaryConstants.InitialSummarySha,
			type: "commit",
			url: `/repos/${repoManagerParams.repoOwner}/${repoManagerParams.repoName}/git/commits/${WholeSummaryConstants.InitialSummarySha}`,
		},
	};
}

export function spoofLazyRepoInitialCommit(
	latestSummaryTreeSha: string,
	repoManagerParams: IRepoManagerParams,
): ICommitDetails {
	return {
		sha: WholeSummaryConstants.InitialSummarySha,
		commit: {
			author: {
				date: new Date().toISOString(),
				email: "dummy@microsoft.com",
				name: "GitRest Service",
			},
			committer: {
				date: new Date().toISOString(),
				email: "dummy@microsoft.com",
				name: "GitRest Service",
			},
			tree: {
				sha: latestSummaryTreeSha,
				url: `/repos/${repoManagerParams.repoOwner}/${repoManagerParams.repoName}/git/trees/${WholeSummaryConstants.InitialSummarySha}`,
			},
			message: "Dummy commit for lazy repo initial summary",
			url: `/repos/${repoManagerParams.repoOwner}/${repoManagerParams.repoName}/git/commits/${WholeSummaryConstants.InitialSummarySha}`,
		},
		parents: [],
		url: `/repos/${repoManagerParams.repoOwner}/${repoManagerParams.repoName}/git/commits/${WholeSummaryConstants.InitialSummarySha}`,
	};
}

export async function retrieveLazyRepoSummary(
	fileSystemManagerFactories: IFileSystemManagerFactories,
	repoManagerParams: IRepoManagerParams,
	gitManagerFactoryParams: Pick<
		IGitManagerFactoryParams,
		"repoPerDocEnabled" | "storageDirectoryConfig"
	>,
): Promise<IWholeFlatSummary | undefined> {
	const fileSystemManagerFactory = getFilesystemManagerFactory(
		fileSystemManagerFactories,
		repoManagerParams.isEphemeralContainer,
	);
	const { directoryPath } = getRepoInfoFromParamsAndStorageConfig(
		gitManagerFactoryParams.repoPerDocEnabled,
		repoManagerParams,
		gitManagerFactoryParams.storageDirectoryConfig,
	);
	const fileSystemManager = fileSystemManagerFactory.create({
		...repoManagerParams.fileSystemManagerParams,
		rootDir: directoryPath,
	});
	const latestFullSummaryDirectory = getLatestFullSummaryDirectory(
		directoryPath,
		repoManagerParams.storageRoutingId?.documentId ?? repoManagerParams.repoName,
	);
	const lumberjackProperties = {
		...getLumberjackBasePropertiesFromRepoManagerParams(repoManagerParams),
	};
	return retrieveLatestFullSummaryFromStorage(
		fileSystemManager,
		latestFullSummaryDirectory,
		lumberjackProperties,
	);
}
