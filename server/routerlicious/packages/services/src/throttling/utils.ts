/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { IThrottlingMetrics } from "@fluidframework/server-services-core";
import {
	CommonProperties,
	ThrottlingTelemetryProperties,
} from "@fluidframework/server-services-telemetry";

export function getThrottlingBaseTelemetryProperties(key?: string) {
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

export function getCommonThrottlingMetricTelemetryProperties(
	remoteId: string,
	throttlingMetrics: IThrottlingMetrics,
) {
	return {
		remoteId,
		// Tokens remaining in the bucket.
		// Existing property name (currentCount) included for backward compatibility with existing dashboards.
		// New property name (tokensAvailable) included for clarity and consistency with local token bucket.
		tokensAvailable: throttlingMetrics.count,
		currentCount: throttlingMetrics.count,
		// Current version of the bucket (sequential)
		currentVersion: throttlingMetrics.version,
		// The last time the bucket was cooled down.
		lastCoolDownAt: throttlingMetrics.lastCoolDownAt,
		// The amount of time until throttling will be lifted.
		retryAfterInMs: throttlingMetrics.retryAfterInMs,
		// The current status of the bucket's throttling state. True = throttled, False = not throttled.
		throttleStatus: throttlingMetrics.throttleStatus,
		// The reason for the throttling
		throttleReason: throttlingMetrics.throttleReason,
	};
}
