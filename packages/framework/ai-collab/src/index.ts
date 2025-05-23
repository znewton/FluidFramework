/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Experimental package for utilities that enable/simplify interaction with LLMs for apps based on SharedTree.
 *
 * See {@link https://github.com/microsoft/FluidFramework/tree/main/packages/framework/ai-collab#readme | README.md }
 * for an overview of the package.
 *
 * @packageDocumentation
 */

export {
	type DifferenceCreate,
	type DifferenceChange,
	type DifferenceMove,
	type DifferenceRemove,
	type Difference,
	type ObjectPath,
	type Options,
	sharedTreeDiff,
	createMergableIdDiffSeries,
	createMergableDiffSeries,
	SharedTreeBranchManager,
	sharedTreeTraverse,
} from "./implicit-strategy/index.js";

export type {
	ApplyEditFailure,
	ApplyEditSuccess,
	CoreEventLoopCompleted,
	CoreEventLoopStarted,
	FinalReviewCompleted,
	FinalReviewStarted,
	GenerateTreeEditCompleted,
	GenerateTreeEditStarted,
	LlmApiCallDebugEvent,
	PlanningPromptCompleted,
	PlanningPromptStarted,
	LlmTreeEdit,
	EventFlowDebugName,
	EventFlowDebugNames,
} from "./explicit-strategy/index.js";

export {
	type AiCollabOptions,
	type AiCollabSuccessResponse,
	type AiCollabErrorResponse,
	type TokenUsage,
	type TokenLimits,
	type OpenAiClientOptions,
	type DebugEvent,
	type DebugEventLogHandler,
	type EventFlowDebugEvent,
} from "./aiCollabApi.js";

export {
	type DiffBase,
	type Diff,
	type NodePath,
	type InsertDiff,
	type ModifyDiff,
	type RemoveDiff,
	type RemoveNodeDiff,
	type ArraySingleRemoveDiff,
	type ArrayRangeRemoveDiff,
	type MoveDiff,
	type MoveSingleDiff,
	type MoveRangeDiff,
} from "./diffTypes.js";

export { aiCollab } from "./aiCollab.js";
