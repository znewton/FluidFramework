/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { AsyncLocalStorage } from "async_hooks";
import * as git from "@fluidframework/gitresources";
import { IThrottler } from "@fluidframework/server-services-core";
import { IThrottleMiddlewareOptions, throttle, getParam } from "@fluidframework/server-services-utils";
import { Router } from "express";
import * as nconf from "nconf";
import safeStringify from "json-stringify-safe";
import winston from "winston";
import { fromUtf8ToBase64 } from "@fluidframework/common-utils";
import { ICache, ITenantService } from "../../services";
import * as utils from "../utils";

export function create(
    store: nconf.Provider,
    tenantService: ITenantService,
    cache: ICache,
    throttler: IThrottler,
    asyncLocalStorage?: AsyncLocalStorage<string>): Router {
    const router: Router = Router();

    const commonThrottleOptions: Partial<IThrottleMiddlewareOptions> = {
        throttleIdPrefix: (req) => getParam(req.params, "tenantId"),
        throttleIdSuffix: utils.Constants.throttleIdSuffix,
    };

    // TODO: Same as routes/git/trees.ts getTree
    async function getTree(
        tenantId: string,
        authorization: string,
        sha: string,
        recursive: boolean,
        useCache: boolean): Promise<git.ITree> {
        const service = await utils.createGitService(tenantId, authorization, tenantService, cache, asyncLocalStorage);
        return service.getTree(sha, recursive, useCache);
    }

    async function getCommits(
        tenantId: string,
        authorization: string,
        sha: string,
        count: number): Promise<git.ICommitDetails[]> {
        const service = await utils.createGitService(tenantId, authorization, tenantService, cache, asyncLocalStorage);
        return service.getCommits(sha, count);
    }

    router.get("/repos/:ignored?/:tenantId/commits",
        throttle(throttler, winston, commonThrottleOptions),
        (request, response, next) => {
            const tenantId: string = request.params.tenantId;
            const authHeader: string = request.get("Authorization");
            const sha: string = utils.queryParamToString(request.query.sha);
            const count: number = utils.queryParamToNumber(request.query.count);
            const commitsP = getCommits(
                tenantId,
                authHeader,
                sha,
                count).then(async (commits) => {
                    if (count === 1 && response.push) {
                        const treeSha = commits[0]?.commit.tree.sha;
                        const host = request.headers.host ? `https://${request.headers.host}` : "";
                        const base64TenantId = encodeURIComponent(fromUtf8ToBase64(tenantId));
                        const treePath = `/repos/${tenantId}/git/trees/${treeSha}?token=${base64TenantId}&recursive=1`;
                        winston.info(`Pushing ${host}${treePath}`);
                        const tree = await getTree(tenantId, authHeader, treeSha, true, true)
                            .catch((error) => {
                                winston.error(`Failed to retrieve tree: ${error}`);
                            });
                        const stream = response.push(`${treePath}`, {
                            request: {
                                accept: "application/json, text/plain, */*",
                                // authorization: authHeader,
                            },
                            response: { "content-type": "application/json" },
                        });
                        stream.on("error", (err) => {
                            winston.error(`Failed to push tree: ${safeStringify(err)}`);
                        });
                        stream.end(JSON.stringify(tree));
                    }
                    return commits;
                });

            utils.handleResponse(
                commitsP,
                response,
                false);
    });

    return router;
}
