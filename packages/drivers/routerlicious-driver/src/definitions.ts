/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { ISnapshotTree } from "@fluidframework/protocol-definitions";
import { ISession } from "@fluidframework/server-services-client";

export interface ISnapshotTreeVersion {
	id: string;
	snapshotTree: ISnapshotTree;
}

export interface IExtendedSession extends ISession {
	clientCorrelationId?: string;
	sessionCorrelationId?: string;
}
