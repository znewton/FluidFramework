/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

export interface IRouterliciousDriverPolicies {
    /**
     * Enable prefetching entire snapshot tree into memory before it is loaded by the runtime.
     * Default: true
     */
    enablePrefetch: boolean;

    /**
     * Enable uploading entire summary tree as a IWholeSummaryPayload to storage.
     * Default: false
     */
    enableWholeSummaryUpload: boolean;
}
