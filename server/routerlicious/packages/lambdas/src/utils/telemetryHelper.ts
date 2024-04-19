/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { DocumentContext } from "@fluidframework/server-lambdas-driver";
import {
	IServiceConfiguration,
	LambdaCloseType,
	NackMessagesType,
	type IWebSocket,
} from "@fluidframework/server-services-core";
import {
	BaseTelemetryProperties,
	CommonProperties,
	Lumber,
	LumberEventName,
	Lumberjack,
	SessionState,
} from "@fluidframework/server-services-telemetry";

/**
 * @internal
 */
export const createSessionMetric = (
	tenantId: string,
	documentId: string,
	lumberEventName: LumberEventName,
	serviceConfiguration: IServiceConfiguration,
): Lumber<any> | undefined => {
	if (!serviceConfiguration.enableLumberjack) {
		return;
	}

	const sessionMetric = Lumberjack.newLumberMetric(lumberEventName);
	sessionMetric?.setProperties({
		[BaseTelemetryProperties.tenantId]: tenantId,
		[BaseTelemetryProperties.documentId]: documentId,
	});

	return sessionMetric;
};

/**
 * @internal
 */
export const logCommonSessionEndMetrics = (
	context: DocumentContext,
	closeType: LambdaCloseType,
	sessionMetric: Lumber | undefined,
	sequenceNumber: number,
	lastSummarySequenceNumber: number,
	activeNackMessageTypes: NackMessagesType[] | undefined,
) => {
	if (!sessionMetric) {
		return;
	}

	const contextError = context.getContextError();

	sessionMetric.setProperties({ [CommonProperties.sessionEndReason]: closeType });
	sessionMetric.setProperties({ [CommonProperties.sessionState]: SessionState.end });
	sessionMetric.setProperties({ [CommonProperties.sequenceNumber]: sequenceNumber });
	sessionMetric.setProperties({
		[CommonProperties.lastSummarySequenceNumber]: lastSummarySequenceNumber,
	});

	if (contextError) {
		sessionMetric.error(`Session terminated due to ${contextError}`);
	} else if (closeType === LambdaCloseType.Error) {
		sessionMetric.error("Session terminated due to error");
	} else if (
		!closeType ||
		closeType === LambdaCloseType.Stop ||
		closeType === LambdaCloseType.Rebalance
	) {
		Lumberjack.info("Session Paused", sessionMetric?.properties);
	} else if (closeType === LambdaCloseType.ActivityTimeout) {
		if (activeNackMessageTypes?.includes(NackMessagesType.SummaryMaxOps)) {
			sessionMetric.error(
				"Session terminated due to inactivity while exceeding max ops since last summary",
			);
		} else {
			sessionMetric.success("Session terminated due to inactivity");
		}
	} else {
		sessionMetric.error("Unknown session end state");
	}
};

/**
 * Logs the average of all data points added to the aggregator over a given interval.
 */
export class PingPongLatencyAggregator {
	private count: number = 0;
	private sumMs: number = 0;

	constructor(
		private readonly metricProperties: Map<string, any> | Record<string, any> = {},
		metricLoggingIntervalMs: number = 60_000,
		private readonly logAsLumberMetric: boolean = false,
	) {
		if (metricLoggingIntervalMs > 0) {
			setInterval(() => {
				this.logMetric();
			}, metricLoggingIntervalMs);
		}
	}

	public trackSocket(socket: IWebSocket): void {
		// TODO: need socketio exposing changes from server/audience validation PR
		this.count++;
		this.sumMs += latency;
	}

	private logMetric(): void {
		const averageMS = this.sumMs / this.count;
		if (this.logAsLumberMetric) {
			const metric = Lumberjack.newLumberMetric(LumberEventName.SocketPingPong, {
				...this.metricProperties,
				metricValue: averageMS,
			});
			metric.success("Socket ping pong average latency");
		} else {
			Lumberjack.info(`${LumberEventName.SocketPingPong}`, {
				...this.metricProperties,
				durationInMs: averageMS,
			});
		}
	}
}
