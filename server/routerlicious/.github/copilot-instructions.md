## Routerlicious AI Assistant Instructions

Purpose: Enable an AI coding agent to be productive quickly in the `server/routerlicious` release group of Fluid Framework. Keep changes small, align with existing patterns, and use provided build/test tooling (fluid-build, flub, pnpm, docker compose).

### 1. High-Level Architecture (Operational Data Flow)

Client WS/HTTP -> Alfred/Nexus (ingress + socket fan‑out) -> Kafka (rawdeltas) -> Deli (sequencing) -> Kafka (deltas) -> Scriptorium (persist ops to MongoDB) -> Scribe (summary ops -> Historian/Git REST) -> Storage (GitRest + Historian) + Redis (pubsub + ephemeral state). Copier taps rawdeltas for verification. Riddler provides auth/tenant API. Config drives service behavior (`packages/routerlicious/config/config.json`).

Key microservice entrypoints (built JS in `packages/routerlicious/dist`):

-   `alfred/www.js`, `nexus/www.js` (client ingress / websocket)
-   `kafka-service/index.js <lambdaName> <path>` generic runner for lambdas (deli, scriptorium, copier, scribe)
-   `riddler/www.js` (auth / tenant)

### 2. Source Layout Essentials

-   `packages/routerlicious/src/` – service implementations & lambdas (alfred, deli, scribe, scriptorium, copier, nexus, riddler, shared utils)
-   `packages/services-*` & `services-core` – service interface definitions & shared abstractions
-   `packages/services-shared` – concrete shared server impls (e.g. `DocumentStorage`, `HttpServer`)
-   `packages/*-ordering-*` and `memory-orderer` – pluggable ordering implementations (Kafka node, rdkafka, memory)
-   `packages/tinylicious` – minimal standalone test service (good for lightweight examples)
-   `packages/routerlicious/config/config.json` – authoritative runtime defaults (Kafka topics, Redis, tenants, throttling, checkpoint heuristics)

### 3. Build & Test Workflow

-   Use pnpm only (enforced via `scripts/only-pnpm.cjs`).
-   Install & build (from repo root folder `server/routerlicious`): `pnpm install` then `npm run build` (invokes `fluid-build -g server --task build`). Use `build:fast` for worker mode.
-   Incremental compile only: `npm run build:compile`.
-   Tests: `npm test` (fan-out to packages). Add `-- --grep <Pattern>` after test script for filtered mocha runs (e.g. `npm run test -- -- --grep Deli`). Coverage: `npm run test:coverage`.
-   Lint/format/policy gates: `npm run checks` (prettier, package lists, version check, layer policy, policy-check). Auto-fix style/policy: `npm run lint:fix`, `npm run policy-check:fix`.
-   API docs generation sequence: build (extractor) -> `npm run build:gendocs`.
-   IMPORTANT: Newly added or modified TypeScript tests must be (re)compiled before they will run; otherwise mocha executes stale `dist` output. Fast path: `pnpm run build:compile && pnpm run test` (or run the two commands separately). Do this before relying on grep-filtered iterations.

### 4. Local Runtime & Debug

-   Primary dev loop uses Docker compose: `npm start` (standard) or `npm run start:debug` (debug compose file). Services launched: alfred, nexus, deli, scriptorium, copier, scribe, riddler, historian, gitrest, git, kafka, zookeeper, redis, mongodb, proxy.
-   Debug Node processes by switching to debug compose and attaching to exposed inspectors (compose debug file sets up). For lambda code change: rebuild (`npm run build`) then `docker compose restart <service>` (script shortcut: `npm run restart`).
-   For a clean slate (volumes removed): `npm run stop:full`.

### 5. Configuration & Environment Conventions

-   Modify service behavior via layered config (environment variables override JSON). Canonical defaults in `packages/routerlicious/config/config.json` (sequence topics, checkpoint heuristics, throttling toggles, tenant bootstrap, Kafka lib selection rdkafka vs memory orderer, Redis clustering flags).
-   Tenants seeded in config (`alfred.tenants` and `tenantConfig` arrays) with placeholder keys; production setups replace these secrets.
-   Logging: Service code uses Winston (`import { logger } from "../utils"`) with level + format controlled by `logger` section; libraries use `debug` namespaces (`DEBUG=fluid:*`). Avoid `console.log` in new code; prefer structured logger.

### 6. Common Patterns & Extension Points

-   Lambdas follow a standard runner pattern: generic Kafka runner invokes specific handler module path passed on command line (see docker-compose commands). When adding a new lambda replicate this pattern and wire group/topic in `config.json` under `lambdas` + compose service.
-   Kafka topic contract: raw client ops -> `rawdeltas`; sequenced ops -> `deltas`. Deli writes sequence numbers; Scriptorium persists; Scribe handles summary ops. Respect this pipeline; do not short‑circuit unless intentionally adding a side-channel (like Copier).
-   Checkpointing heuristics (batch size/time/idle) configurable per lambda; keep defaults unless performance change justified—update `checkpointHeuristics` block.
-   Orderer abstraction: Use memory orderer for tests by specifying tenant `orderer.type = memory` in config; Kafka libs chosen via `kafka.lib.name` (rdkafka by default). New ordering methods implement core interfaces in `services-core` / `services-ordering-*`.
-   Storage: Snapshot writes go through Historian (Git REST; content-addressable). Avoid direct FS writes; use provided storage interfaces.

### 7. Adding / Modifying Code Safely

-   Co-locate new service-specific code under the existing service folder in `packages/routerlicious/src/<serviceName>` to align with distribution outputs.
-   Export shared abstractions through existing `services-` packages instead of creating ad-hoc cross-package dependencies—maintains layer policy (`flub check layers`). If layer violations arise, adjust dependency direction rather than suppressing.
-   Always run `npm run checks` before committing to catch policy/version/layer issues early.

### 8. Testing Guidance (Project-Specific)

-   Prefer unit tests colocated under `src/test` per package; they’re excluded from coverage patterns only when in dist/lib.
-   For sequencing or pipeline scenarios, use memory orderer + in-memory Mongo/Redis stubs where possible, otherwise use docker compose ephemeral environment.
-   Use mocha grep strategy for focused iteration on lambdas (e.g. Deli sequencing).

### 9. Telemetry & Metrics

-   Lumberjack / Winston integration enabled with global context by default (`lumberjack.options`). New telemetry contexts should piggyback existing logger/metric utilities; avoid bespoke metric emitters.

### 10. When Unsure

Reference `README.md` at repo root for high-level microservice roles and `docs/Routerlicious-Architecture.svg`. Mirror existing service folder patterns; avoid introducing new build scripts—hook into fluid-build / flub tasks.

---

Provide feedback if you need deeper detail on: (a) adding a new lambda, (b) extending ordering implementations, (c) performance tuning checkpoints.
