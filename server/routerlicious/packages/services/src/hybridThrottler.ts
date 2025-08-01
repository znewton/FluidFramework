/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import {
	type IThrottler,
	type IThrottlerHelper,
	type IThrottlerResponse,
	ThrottlingError,
	type ILogger,
	type IUsageData,
} from "@fluidframework/server-services-core";
import {
	CommonProperties,
	Lumberjack,
	ThrottlingTelemetryProperties,
} from "@fluidframework/server-services-telemetry";
import LRUCache from "lru-cache";

import { LocalTokenBucketHelper, type ILocalTokenBucketConfig } from "./localTokenBucketHelper";

/**
 * Configuration for local instance throttling between distributed sync-ups
 * @internal
 */
export interface ILocalThrottleConfig {
	/**
	 * Maximum operations per second for local instance throttling.
	 * This should be set conservatively as a fraction of the global limit.
	 * For example, if global limit is 1000 ops/sec and you have 10 instances,
	 * set this to ~80-100 ops/sec per instance to allow some headroom.
	 */
	maxLocalOpsPerSecond: number;

	/**
	 * Local burst capacity - how many operations can be processed in a burst
	 * before local throttling kicks in. Should be aligned with expected traffic patterns.
	 * Default: maxLocalOpsPerSecond (1 second worth of operations)
	 */
	localBurstCapacity?: number;

	/**
	 * How often to replenish local tokens, in milliseconds.
	 * Smaller values = more responsive to traffic spikes but more CPU overhead.
	 * Default: 100ms
	 */
	localReplenishIntervalMs?: number;
}

/**
 * A hybrid throttler that combines distributed throttling (via ThrottlerHelper + Redis)
 * with local instance-level throttling to handle sharp traffic spikes between sync intervals.
 *
 * Architecture:
 * - Maintains local token buckets per instance to catch sharp spikes immediately
 * - Periodically syncs with distributed storage (Redis) for global coordination
 * - Uses the most restrictive result (local OR distributed throttling)
 * - Provides immediate feedback for traffic spikes while maintaining global limits
 *
 * @internal
 */
export class HybridThrottler implements IThrottler {
	private readonly lastThrottleUpdateAtMap: LRUCache<string, number>;
	private readonly countDeltaMap: LRUCache<string, number>;
	private readonly throttlerResponseCache: LRUCache<string, IThrottlerResponse>;
	private readonly localTokenBucket: LocalTokenBucketHelper;

	constructor(
		private readonly throttlerHelper: IThrottlerHelper,
		localThrottleConfig: ILocalThrottleConfig,
		private readonly minThrottleIntervalInMs: number = 60000, // Reduced from 1000000ms to 1 min
		private readonly logger?: ILogger,
		/**
		 * Maximum number of keys that should be internally tracked at a given time.
		 * Fine tune this and cache age to balance accuracy and memory consumption.
		 * If this value is less than number of keys (traffic) per cache age time, the in-memory cache can overflow.
		 * Default: 1,000
		 */
		maxCacheSize: number = 1000,
		/**
		 * When to mark internal cache values as stale, in milliseconds. In production, this value should not be
		 * lower than minThrottleIntervalInMs, otherwise throttle counts will be lost between calculation intervals.
		 * Default: 5min
		 */
		maxCacheAge: number = 1000 * 60 * 5,
		/**
		 * Throttling can generate a lot of telemetry, which can be expensive and/or taxing on resources.
		 * Use this flag to enable/disable extra telemetry that is useful for validating throttling config correctness.
		 * Default: false
		 */
		private readonly enableEnhancedTelemetry: boolean = false,
	) {
		// Validate local throttle config
		if (localThrottleConfig.maxLocalOpsPerSecond <= 0) {
			throw new Error("maxLocalOpsPerSecond must be greater than 0");
		}

		// Initialize local token bucket helper
		const localBucketConfig: ILocalTokenBucketConfig = {
			opsPerSecond: localThrottleConfig.maxLocalOpsPerSecond,
			burstCapacity: localThrottleConfig.localBurstCapacity,
			replenishIntervalMs: localThrottleConfig.localReplenishIntervalMs,
			maxBuckets: maxCacheSize,
			maxAgeMs: maxCacheAge,
		};
		this.localTokenBucket = new LocalTokenBucketHelper(localBucketConfig);

		const cacheOptions: LRUCache.Options<string, any> = {
			max: maxCacheSize,
			maxAge: maxCacheAge,
		};

		this.lastThrottleUpdateAtMap = new LRUCache({
			...cacheOptions,
			dispose: this.enableEnhancedTelemetry
				? (key, value: number) => {
						const now = Date.now();
						if (now - value < maxCacheAge) {
							const telemetryProperties = this.getBaseTelemetryProperties(key);
							const lumberjackProperties = {
								...telemetryProperties.baseLumberjackProperties,
								ageInMs: now - value,
							};
							this.logger?.warn(
								`Purged lastThrottleUpdateAt for ${key} before maxAge reached`,
								{ messageMetaData: telemetryProperties.baseMessageMetaData },
							);
							Lumberjack.warning(
								`Purged lastThrottleUpdateAt for ${key} before maxAge reached`,
								lumberjackProperties,
							);
						}
				  }
				: undefined,
		});

		this.countDeltaMap = new LRUCache(cacheOptions);
		this.throttlerResponseCache = new LRUCache(cacheOptions);
	}

	/**
	 * Increments operation count and calculates throttle status.
	 * Performs BOTH local and distributed throttling checks.
	 * @throws {@link ThrottlingError} if throttled by either local or distributed limits
	 */
	public incrementCount(
		id: string,
		weight: number = 1,
		usageStorageId?: string,
		usageData?: IUsageData,
	): void {
		const telemetryProperties = this.getBaseTelemetryProperties(id);

		// STEP 1: Check local throttling first (immediate response)
		const localThrottleResult = this.checkLocalThrottling(id, weight);
		if (localThrottleResult.isThrottled) {
			this.logger?.info(`Locally throttled: ${id}`, {
				messageMetaData: {
					...telemetryProperties.baseMessageMetaData,
					reason: localThrottleResult.reason,
					retryAfterInSeconds: Math.ceil(localThrottleResult.retryAfterInMs / 1000),
					throttleType: "local",
				},
			});
			Lumberjack.info(`Locally throttled: ${id}`, {
				...telemetryProperties.baseLumberjackProperties,
				[ThrottlingTelemetryProperties.reason]: localThrottleResult.reason,
				[ThrottlingTelemetryProperties.retryAfterInSeconds]: Math.ceil(
					localThrottleResult.retryAfterInMs / 1000,
				),
				throttleType: "local",
			});
			// eslint-disable-next-line @typescript-eslint/no-throw-literal
			throw new ThrottlingError(
				localThrottleResult.reason,
				Math.ceil(localThrottleResult.retryAfterInMs / 1000),
			);
		}

		// STEP 2: Update distributed count delta (for eventual consistency)
		this.updateCountDelta(id, weight);

		// STEP 3: Trigger distributed throttle check in background (non-blocking)
		this.updateAndCacheThrottleStatus(id, usageStorageId, usageData).catch((error) => {
			this.logger?.error(
				`Error encountered updating and/or caching throttle status for ${id}: ${error}`,
				{ messageMetaData: telemetryProperties.baseMessageMetaData },
			);
			Lumberjack.error(
				`Error encountered updating and/or caching throttle status for ${id}`,
				telemetryProperties.baseLumberjackProperties,
				error,
			);
		});

		// STEP 4: Check cached distributed throttle status
		const cachedThrottlerResponse = this.throttlerResponseCache.get(id);
		if (cachedThrottlerResponse && cachedThrottlerResponse.throttleStatus) {
			const retryAfterInSeconds = Math.ceil(cachedThrottlerResponse.retryAfterInMs / 1000);
			this.logger?.info(`Distributed throttled: ${id}`, {
				messageMetaData: {
					...telemetryProperties.baseMessageMetaData,
					reason: cachedThrottlerResponse.throttleReason,
					retryAfterInSeconds,
					throttleType: "distributed",
				},
			});
			Lumberjack.info(`Distributed throttled: ${id}`, {
				...telemetryProperties.baseLumberjackProperties,
				[ThrottlingTelemetryProperties.reason]: cachedThrottlerResponse.throttleReason,
				[ThrottlingTelemetryProperties.retryAfterInSeconds]: retryAfterInSeconds,
				throttleType: "distributed",
			});
			// eslint-disable-next-line @typescript-eslint/no-throw-literal
			throw new ThrottlingError(cachedThrottlerResponse.throttleReason, retryAfterInSeconds);
		}
	}

	/**
	 * Decrements operation count for both local and distributed tracking.
	 */
	public decrementCount(id: string, weight: number = 1): void {
		// Update distributed count
		this.updateCountDelta(id, -weight);

		// Return tokens to local bucket (allows for immediate retry)
		this.localTokenBucket.returnTokens(id, weight);
	}

	/**
	 * Check local throttling using token bucket algorithm
	 * @param id - The throttle ID
	 * @param weight - Operation weight
	 * @returns Local throttle result
	 */
	private checkLocalThrottling(
		id: string,
		weight: number,
	): {
		isThrottled: boolean;
		reason: string;
		retryAfterInMs: number;
	} {
		const result = this.localTokenBucket.tryConsumeTokens(id, weight);

		return {
			isThrottled: result.isThrottled,
			reason: result.reason,
			retryAfterInMs: result.retryAfterInMs,
		};
	}

	private updateCountDelta(id: string, value: number): void {
		const currentValue = this.countDeltaMap.get(id) || 0;
		this.countDeltaMap.set(id, currentValue + value);
	}

	private async updateAndCacheThrottleStatus(
		id: string,
		usageStorageId?: string,
		usageData?: IUsageData,
	): Promise<void> {
		const telemetryProperties = this.getBaseTelemetryProperties(id);

		const now = Date.now();
		if (this.lastThrottleUpdateAtMap.get(id) === undefined) {
			if (this.enableEnhancedTelemetry) {
				this.logger?.info(`Starting to track throttling status for ${id}`, {
					messageMetaData: telemetryProperties.baseMessageMetaData,
				});
				Lumberjack.info(
					`Starting to track throttling status for ${id}`,
					telemetryProperties.baseLumberjackProperties,
				);
			}
			this.lastThrottleUpdateAtMap.set(id, now);
		}

		const lastThrottleUpdateTime = this.lastThrottleUpdateAtMap.get(id);
		if (
			lastThrottleUpdateTime !== undefined &&
			now - lastThrottleUpdateTime > this.minThrottleIntervalInMs
		) {
			const countDelta = this.countDeltaMap.get(id) ?? 0;
			this.lastThrottleUpdateAtMap.set(id, now);
			this.countDeltaMap.set(id, 0);
			const messageMetaData = {
				...telemetryProperties.baseMessageMetaData,
				weight: countDelta,
			};
			const lumberjackProperties = {
				...telemetryProperties.baseLumberjackProperties,
				[ThrottlingTelemetryProperties.weight]: countDelta,
			};
			// populate usageData with relevant data.
			if (usageData) {
				usageData.value = countDelta;
				usageData.startTime = lastThrottleUpdateTime;
				usageData.endTime = now;
			}
			await this.throttlerHelper
				.updateCount(id, countDelta, usageStorageId, usageData)
				.then((throttlerResponse) => {
					if (this.enableEnhancedTelemetry) {
						this.logger?.info(`Incremented throttle count for ${id} by ${countDelta}`, {
							messageMetaData,
						});
						Lumberjack.info(
							`Incremented throttle count for ${id} by ${countDelta}`,
							lumberjackProperties,
						);
					}
					this.throttlerResponseCache.set(id, throttlerResponse);
				})
				.catch((err) => {
					this.logger?.error(`Failed to update throttling count for ${id}: ${err}`, {
						messageMetaData,
					});
					Lumberjack.error(
						`Failed to update throttling count for ${id}`,
						lumberjackProperties,
						err,
					);
				});
		}
	}

	private getBaseTelemetryProperties(key: string) {
		return {
			baseMessageMetaData: {
				key,
				eventName: "throttling",
			},
			baseLumberjackProperties: {
				[CommonProperties.telemetryGroupName]: "throttling",
				[ThrottlingTelemetryProperties.key]: key,
			},
		};
	}
}
