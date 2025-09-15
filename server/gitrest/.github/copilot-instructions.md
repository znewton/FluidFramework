# Copilot Instructions: gitrest Service

Purpose: Provide AI agents with concise, project-specific guidance to be immediately productive when modifying or extending the gitrest service within FluidFramework.

## 1. High-Level Architecture

-   Two packages: `@fluidframework/gitrest` (runtime entrypoint) and `@fluidframework/gitrest-base` (reusable core: routing, repo mgmt, summaries, FS abstractions, telemetry helpers).
-   Entry process: `packages/gitrest/src/www.ts` loads `config.json`, configures logging, then calls `runService(GitrestResourcesFactory, GitrestRunnerFactory, ...)` which wires up a `GitrestRunner` (`runner.ts`).
-   `GitrestRunner` builds an Express app via `app.create()` and hosts it through an injected `IWebServerFactory` (Fluid server-services core infra) to standardize health/readiness and logging.
-   Route assembly: `routes/index.ts` composes discrete routers under GitHub-compatible REST paths (`/repos/:owner/:repo/git/...`, plus repo-level contents, commits, summaries APIs).
-   Core Git operations implemented via `IsomorphicGitRepositoryManager` (`utils/isomorphicgitManager.ts`) wrapping `isomorphic-git` with telemetry, error normalization (throws `NetworkError`), and object conversion helpers.
-   Summary (Fluid DDS/container state) handling consolidated in `GitWholeSummaryManager` (`utils/gitWholeSummaryManager.ts`) supporting whole-summary read/write/delete plus feature flags for low I/O pathways.
-   Filesystem abstraction & pluggability: Factories (`IFileSystemManagerFactories`) allow switching between node FS, Redis-backed (`utils/redisFs`), or external storage. Repo-per-document model supported (see helpers around `storageRoutingId`).

## 2. Key Conventions & Patterns

-   Errors surfaced to clients should use `NetworkError` (from server-services-client) with appropriate HTTP status; internal errors are logged with `Lumberjack` before rethrow.
-   Telemetry: Always enrich metrics with repo/document/tenant context. Use `Lumberjack.newLumberMetric` naming from `gitrestTelemetryDefinitions` and attach base props from repository manager params helpers.
-   Request context enrichment: In `app.create()`, middleware attaches `tenantId` & `documentId` to `res.locals` based on repo params—reuse rather than recomputing.
-   Logging style governed by `logger:morganFormat` config ("json" enables structured logging + optional response close & event loop lag metrics). Maintain compatibility when adding middleware (insert before routes).
-   Response size limits enforced via `ResponseSizeMiddleware`; avoid streaming large buffers directly—respect configured MB cap (`responseSizeLimitInMegabytes`).
-   Summary operations distinguish channel vs container summaries via type guards (`isChannelSummary`, `isContainerSummary`). Always check & branch accordingly.
-   For Git object validation (blobs), call `validateBlobContent` / `validateBlobEncoding` before write.
-   Repository initialization may use "slim" init (reduced IO) if enabled; keep optionality when adding init-time features.

## 3. Build, Test, Run Workflows

-   Monorepo uses pnpm workspaces; root package.json (this release group) orchestrates multi-package scripts.
-   Install deps: `pnpm install` (guarded by `scripts/only-pnpm.cjs` preinstall).
-   Build fast (compile only): `npm run build:compile`; Full (compile + lint): `npm run build`.
-   Develop with live container + mounted source: `npm run start:dev` (docker-compose with `docker-compose.yml` + `docker-compose.dev.yml`). After code changes: `npm run build` then `docker-compose restart gitrest`.
-   Direct node start (after build): `npm run start` (runs `packages/gitrest/dist/www.js`).
-   Tests (multi-package): `npm test` at root; coverage: `npm run test:coverage` (c8). Package-local tests in `gitrest-base` under `src/test` compiled to `dist/test`.
-   Docker image build: `npm run build:docker` (passes root context for required shared assets). For quick manual container: `docker build -t gitrest .` then run with appropriate port mounts.

## 4. Adding / Modifying Endpoints

-   Add new router under `packages/gitrest-base/src/routes/...`; export a `create(store, fileSystemManagerFactories, repoManagerFactory)` returning an Express Router.
-   Register it in `routes/index.ts` and then it’s auto-mounted in `app.ts` (order there defines middleware precedence).
-   Use existing patterns in `routes/git/*` (e.g., `blobs.ts`) for request parsing, repoManager acquisition, error handling, telemetry, and response shape.
-   Always extract repo context via helpers like `getRepoManagerParamsFromRequest` & then resolve a repo manager via `repositoryManagerFactory`.

## 5. Repository & Storage Handling

-   Repo path resolution uses helpers: `getRepoPath`, `getGitDirectory`, and parsing of `IStorageRoutingId` (tenantId/documentId) for repo-per-doc mode.
-   Soft delete semantics for summaries: marker file path from `getSoftDeletedMarkerPath`; check with `checkSoftDeleted` before operations.
-   External storage involvement (blobs/summaries) toggled by config flags (`externalStorageEnabled`, feature flags objects). Preserve pass-through of `externalStorageEnabled` when adding summary logic.

## 6. Performance & Reliability Considerations

-   Favor `slimInit` path in `IsomorphicGitManagerFactory` only when feature flag indicates; do not assume HEAD or full git dir scaffolding exists.
-   Respect `maxBlobSizeBytes` and any API metrics sampling parameters if adding high-volume operations.
-   For operations that may exceed response size cap, consider pagination or pre-signed external storage references (pattern present in broader Fluid services; keep interface compatibility).

## 7. Telemetry & Metrics Checklist (when adding code)

-   Create metric early: `const metric = Lumberjack.newLumberMetric(EventName, baseProps)`.
-   On success: `metric.success("<short message>")` and set salient IDs (`commitSha`, `treeId`, etc.).
-   On failure: `metric.error("<context>", error)` then rethrow or wrap in `NetworkError`.

## 8. Safe Extension Tips

-   Mimic structure of existing route modules; avoid embedding logic directly in `app.ts`.
-   Keep public exports aggregated in `src/index.ts` (gitrest-base) to maintain the contract for consumers.
-   Do not couple to concrete filesystem implementations; depend on `IFileSystemManager` / factories.
-   Guard feature-flagged code paths with defaults (see `DefaultSummaryWriteFeatureFlags`).

## 9. Common Pitfalls

-   Forgetting to update route registration => endpoint never reachable.
-   Throwing raw errors instead of `NetworkError` => inconsistent HTTP responses.
-   Bypassing size/encoding validation for blobs => downstream failures or security issues.
-   Adding middleware after routes => telemetry / limits not applied.

## 10. Quick File Landmarks

-   Service entry: `packages/gitrest/src/www.ts`
-   App wiring: `packages/gitrest-base/src/app.ts`
-   Runner lifecycle: `packages/gitrest-base/src/runner.ts`
-   Routes: `packages/gitrest-base/src/routes/**/*`
-   Repo management: `packages/gitrest-base/src/utils/isomorphicgitManager.ts`
-   Summaries: `packages/gitrest-base/src/utils/gitWholeSummaryManager.ts`
-   Telemetry definitions: `packages/gitrest-base/src/utils/gitrestTelemetryDefinitions.ts`
-   FS abstractions: `packages/gitrest-base/src/utils/redisFs/*` + related helpers.

---

Feedback welcome: Identify unclear sections (e.g., more detail on config flags, repo-per-doc, external storage flow) and we can iterate.
