/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import type { RequestListener } from "http";
import { createServer, ServerOptions, server as spdyServer } from "spdy";
import type { IWebServer} from "@fluidframework/server-services-core";
import { HttpServer, WebServer } from "@fluidframework/server-services-shared";

export interface IHttp2WebServerFactory {
    create(requestListener: RequestListener, options: ServerOptions): IWebServer;
}

export class Http2WebServerFactory implements IHttp2WebServerFactory {
    public create(requestListener: RequestListener, options: ServerOptions): IWebServer {
        // Create the base HTTP server and register the provided request listener
        const server = createServer(options, requestListener);
        const httpServer = new HttpServer(server);

        // eslint-disable-next-line no-null/no-null
        return new WebServer(httpServer, null);
    }
}

/**
 * `spdy` exposes Response.push() for implementing HTTP/2-Push, but does not add the type to express.
 */
declare module "express-serve-static-core" {
    export interface Response {
        push(filename: string, options: spdyServer.PushOptions): any;
    }
}
