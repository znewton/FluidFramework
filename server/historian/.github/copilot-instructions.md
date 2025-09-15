# AI Coding Agent Instructions for Historian Service

Purpose: Enable an AI assistant to quickly contribute to the Historian service (Git-like history + summary proxy) within Fluid Framework.

## 1. Core Architecture

-   Two packages: `packages/historian` (runtime entrypoint) and `packages/historian-base` (implementation: app, routes, services, runners).
-   Entry startup chain: `packages/historian/src/www.ts` → `runService()` with `HistorianResourcesFactory` + `HistorianRunnerFactory` → builds `HistorianResources` (`runnerFactory.ts`) → creates Express app via `app.ts`.
-   Express layering in `app.ts`: telemetry + abort-signal middleware → logging (JSON Morgan when `config.logger.morganFormat === "json"`) → body parsers → compression/cors → route registration → health endpoints → 404 + error handlers.
-   Routes grouped in `routes/index.ts`: `git/*` (blobs, commits, refs, tags, trees), `repository/*` (commits, contents, headers), and `summaries` (special logic & throttling). All route factories receive identical dependency tuple (`CommonRouteParams`).
-   Git + summary operations abstracted through `RestGitService` (`services/restGitService.ts`), which wraps REST calls to underlying storage (Git REST service) and manages selective Redis caching (blobs, commits, trees, headers, latest summary only).
-   Throttling strategy: per-tenant + per-cluster maps (`restTenantThrottlers`, `restClusterThrottlers`) keyed by prefixes in `Constants` (e.g. `createSummaryThrottleIdPrefix`). Applied in route middleware (`summaries.ts`).
-   Tenancy + token flow: `RiddlerService` (tenant metadata + token rules) and `DocumentManager` (document existence + cache) provided through `HistorianResourcesFactory`.
-   Ephemeral container handling: header `Is-Ephemeral-Container` influences caching & summary creation; TTL configured via `restGitService:ephemeralDocumentTTLSec` in `config.json`.

## 2. Config & Environment

-   Default service config: `packages/historian/config.json` (logger, Redis, throttling, cache size/type, TTLs, endpoints: `riddler`, `alfred`).
-   Toggle JSON logging & metrics via `logger.morganFormat`, `enableResponseCloseLatencyMetric`, `enableEventLoopLagMetric`.
-   Redis roles: (1) Git object + summary cache, (2) tenant cache, (3) throttling storage, (4) invalid token cache. Multiple `RedisClientConnectionManager` instances created in `runnerFactory.ts`.
-   Per-doc storage routing optional: `storage:perDocEnabled` flag enables `StorageNameRetriever` injection; otherwise `storageNameRetriever` is `undefined` (code frequently tolerates this).

## 3. Caching Rules (Important for Changes)

-   Cache keys uniformly colon-delimited: examples: `tenantId:sha` (blob), `commitSha:header`, `tenantId:documentId:summary:container`.
-   Only the "latest" summary (container type) is cached; lookup path first checks a cached SHA (`LatestSummaryShaKey`) before fetching full summary.
-   When creating a summary: if size > `maxCacheableSummarySize` or not container-type, previous cached summary is invalidated.
-   Write operations proactively prefetch related objects (e.g. tree + header after commit) to warm cache.
-   All cache operations are wrapped with retry via `runWithRetry`; failures log but do not fail the request.

## 4. Throttling Patterns

-   Middleware factory `throttle(throttler, winston, options)` used with dynamic `throttleIdPrefix`/`throttleIdSuffix` to separate tenant vs cluster scopes.
-   Summary routes apply: (1) cluster-level, then (2) tenant-level throttles for both GET and POST.
-   When adding new routes requiring rate limits, mimic pattern in `summaries.ts` and choose/create appropriate `Constants` prefixes.

## 5. Security & Token Handling

-   Token verification: `utils.verifyToken(revokedTokenChecker, scopes[], maxTokenLifetimeSec)` appears in each protected route (see `summaries.ts`). Ensure new protected routes reuse the same helper for consistent lifetime + revocation semantics.
-   Deny lists: `DenyList` checks both tenant and document unless explicitly skipped (delete summary route passes `skipDocumentDenyListCheck=true`).
-   Required scopes for summary create: `DocRead`, `DocWrite`, `SummaryWrite`.

## 6. Development Workflow

-   Install: `npm install -g pnpm && pnpm i` at repo root (`server/historian`).
-   Build all packages: `npm run build` (runs `build:compile` across workspace then lint). For only TS compile: `npm run build:compile`.
-   Start (compiled output): `npm start` (executes `node packages/historian/dist/www.js`). Ensure `pnpm run -r build:compile` first.
-   Test: `npm test` (runs each package's test script; `historian-base` uses Mocha on transpiled `dist/test`). For coverage: `pnpm -F @fluidframework/historian-base run test:coverage`.
-   Clean: `npm run clean` removes `dist` and `*.tsbuildinfo`.
-   Docker (prod image): `npm run build:docker` or direct `docker build -t historian .` from `server/historian`.
-   Dev in container (legacy docs): run Node 8 image + mount; modern development should match engines supported by dependencies (update docs if bumping runtime).

## 7. Code Conventions

-   Prefer dependency injection via factory creation tuple (`CommonRouteParams`) rather than importing singletons inside routes.
-   Logging: use `winston` for simple info/error and `Lumberjack` for structured telemetry; always include tenant/document when available (`BaseTelemetryProperties`).
-   HTTP handlers resolve async operations via `utils.handleResponse(promise, res, cacheableFlag, ...)`; replicate for consistency.
-   Avoid crashing on cache/Redis issues—log and proceed.
-   Headers standardized (examples): `Storage-Name`, `Storage-Routing-Id`, `Is-Ephemeral-Container`, custom summary query params (`initial`, `disableCache`).

## 8. Adding a New Route (Mini Checklist)

1. Implement route module under `src/routes/...` exporting `create(...commonRouteParams)`.
2. Use `validateRequestParams` for required path params.
3. Apply appropriate throttles (tenant + cluster) if externally callable.
4. Call `utils.verifyToken` with minimal necessary scopes.
5. Use `denyListMiddleware` unless operation is a deletion that intentionally skips document checks.
6. Construct or re-use a Git service via `utils.createGitService` rather than instantiating `RestGitService` directly.
7. Return via `utils.handleResponse` to ensure consistent error + telemetry behavior.
8. Register in `routes/index.ts` and wire into `app.ts`.

## 9. Common Pitfalls

-   Forgetting to warm cache after write (see `createCommit`, `createSummary`) leads to immediate cache misses; emulate existing pattern.
-   Not updating both tenant & cluster throttler maps when introducing a new throttle prefix.
-   Bypassing `utils.verifyToken` loses revocation + lifetime enforcement.
-   Caching non-latest summaries will contradict design; only latest container summary is cached.

## 10. Quick Reference of Key Files

-   Startup: `packages/historian/src/www.ts`
-   Express setup: `packages/historian-base/src/app.ts`
-   Resource + runner factories: `packages/historian-base/src/runnerFactory.ts`
-   Core service REST wrapper & caching: `packages/historian-base/src/services/restGitService.ts`
-   Summary route logic & throttling example: `packages/historian-base/src/routes/summaries.ts`
-   Config (service defaults): `packages/historian/config.json`

Feedback welcome: Identify unclear sections (e.g., throttling IDs, cache key formats, adding per-doc storage) and they can be elaborated.
