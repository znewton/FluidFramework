/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

export const Constants = Object.freeze({
	/**
	 * The special value used to point at the most recent summary version without knowing the actual sha.
	 */
	LatestSummarySha: "latest",
	/**
	 * The tree path name used for every {@link IFullGitTree} stored as a single blob.
	 */
	FullTreeBlobPath: ".fullTree",
	/**
	 * Sha1 hash of "initialsummarysha". Used to refer to the initial summary when using lazy git repo feature.
	 */
	InitialSummarySha: "0b4e9f3268009e4a5dc7a9caec4d8de9ee4ce7e9",
});
