/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import * as path from "path";
import { NetworkError } from "@fluidframework/server-services-client";
import { Response } from "express";
import nconf from "nconf";
import { decode } from "jsonwebtoken";
import { ITokenClaims } from "@fluidframework/protocol-definitions";

/**
 * Helper function to handle a promise that should be returned to the user
 */
export function handleResponse<T>(
    resultP: Promise<T>,
    response: Response,
    cache = true,
    status: number = 200,
    handler: (value: T) => void = (value) => value) {
    resultP.then(handler).then(
        (result) => {
            if (cache) {
                response.setHeader("Cache-Control", "public, max-age=31536000");
            }

            response.status(status).json(result);
        },
        (error) => {
            response.status(400).json(error);
        });
}

export function getGitDir(store: nconf.Provider, tenantId: string) {
    const directory = store.get("storage");
    return path.join(directory, `./${tenantId}`);
}

export function parseAuthToken(tenantId: string, authorization: string): ITokenClaims {
    let token: string;
    if (authorization) {
        // eslint-disable-next-line @typescript-eslint/prefer-regexp-exec
        const base64TokenMatch = authorization.match(/Basic (.+)/);
        if (!base64TokenMatch) {
            throw new NetworkError(403, "Malformed authorization token");
        }
        const encoded = Buffer.from(base64TokenMatch[1], "base64").toString();

        // eslint-disable-next-line @typescript-eslint/prefer-regexp-exec
        const tokenMatch = encoded.match(/(.+):(.+)/);
        if (!tokenMatch || tenantId !== tokenMatch[1]) {
            throw new NetworkError(403, "Malformed authorization token");
        }

        token = tokenMatch[2];
    }

    return decode(token) as ITokenClaims;
}
