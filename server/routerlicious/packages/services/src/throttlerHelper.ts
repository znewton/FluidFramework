/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import type {
	IUsageData,
	IThrottlerHelper,
	IThrottlerResponse,
	IThrottleAndUsageStorageManager,
	IThrottlingMetrics,
} from "@fluidframework/server-services-core";

import {
	BaseTokenBucket,
	type ITokenBucketConfig,
	type ITokenBucketState,
} from "./baseTokenBucket";

/**
 * Implements the Token Bucket algorithm to calculate rate-limiting for throttling operations.
 * Now uses shared base classes for consistent token bucket behavior.
 * @internal
 */
export class ThrottlerHelper extends BaseTokenBucket implements IThrottlerHelper {
	constructor(
		private readonly throttleAndUsageStorageManager: IThrottleAndUsageStorageManager,
		rateInOperationsPerMs: number = 1000000,
		operationBurstLimit: number = 1000000,
		minCooldownIntervalInMs: number = 1000000,
	) {
		const config: ITokenBucketConfig = {
			tokensPerMs: rateInOperationsPerMs,
			maxTokens: operationBurstLimit,
			minReplenishIntervalMs: minCooldownIntervalInMs,
		};
		super(config);
	}

	public async updateCount(
		id: string,
		weight: number = 1,
		usageStorageId?: string,
		usageData?: IUsageData,
	): Promise<IThrottlerResponse> {
		const now = Date.now();

		// Get or create the current bucket state
		const storedMetric = await this.throttleAndUsageStorageManager.getThrottlingMetric(id);
		const currentState = storedMetric
			? this.getBucketStateFromStorage(storedMetric)
			: this.createInitialState(now);

		// Attempt to consume tokens using the base class logic
		const result = this.consumeTokens(currentState, weight, now);

		// Convert result back to storage format and save
		const updatedMetric = this.convertToThrottlingMetrics(result.newState);
		await this.setThrottlingMetricAndUsageData(id, updatedMetric, usageStorageId, usageData);

		return this.getThrottlerResponseFromThrottlingMetrics(updatedMetric);
	}

	/**
	 * Convert stored throttling metrics to BaseTokenBucket state format
	 */
	private getBucketStateFromStorage(throttlingMetric: IThrottlingMetrics): ITokenBucketState {
		return {
			// In the old system, 'count' represented available tokens in the bucket
			// This is the same as BaseTokenBucket's 'tokens' field
			tokens: throttlingMetric.count,
			lastReplenishAt: throttlingMetric.lastCoolDownAt,
			isThrottled: throttlingMetric.throttleStatus,
			throttleReason: throttlingMetric.throttleReason,
			retryAfterInMs: throttlingMetric.retryAfterInMs,
		};
	}

	/**
	 * Convert BaseTokenBucket state to stored throttling metrics format
	 */
	private convertToThrottlingMetrics(state: ITokenBucketState): IThrottlingMetrics {
		return {
			// Convert back to the legacy format where 'count' represents available tokens
			count: state.tokens,
			lastCoolDownAt: state.lastReplenishAt,
			throttleStatus: state.isThrottled,
			throttleReason: state.throttleReason,
			retryAfterInMs: state.retryAfterInMs,
		};
	}

	public async getThrottleStatus(id: string): Promise<IThrottlerResponse | undefined> {
		const throttlingMetric = await this.throttleAndUsageStorageManager.getThrottlingMetric(id);
		if (!throttlingMetric) {
			return undefined;
		}
		return this.getThrottlerResponseFromThrottlingMetrics(throttlingMetric);
	}

	private async setThrottlingMetricAndUsageData(
		id: string,
		throttlingMetric: IThrottlingMetrics,
		usageStorageId?: string,
		usageData?: IUsageData,
	) {
		await (usageStorageId && usageData
			? this.throttleAndUsageStorageManager.setThrottlingMetricAndUsageData(
					id,
					throttlingMetric,
					usageStorageId,
					usageData,
			  )
			: this.throttleAndUsageStorageManager.setThrottlingMetric(id, throttlingMetric));
	}

	private getThrottlerResponseFromThrottlingMetrics(
		throttlingMetric: IThrottlingMetrics,
	): IThrottlerResponse {
		return {
			throttleStatus: throttlingMetric.throttleStatus,
			throttleReason: throttlingMetric.throttleReason,
			retryAfterInMs: throttlingMetric.retryAfterInMs,
		};
	}
}
