# CLAUDE.md

Guidance for Claude Code and other coding agents working in this repository. It states the rules the code relies on;
the history is in git and `CHANGELOG.md`. Related documents:

- `README.md` (Polish) — what the app does for users: flags, environments, rules, roles.
- `context/foundation/prd.md` — product requirements (FR-001…FR-017), and `implementation-status.md` — where each
  stands (keep it in step when a change moves one); `context/foundation/tech-stack.md` — the intended stack
  (NestJS + PostgreSQL/Prisma + OIDC; OIDC is not built yet).
- `docs/TODO.md` (Polish) — known gaps and planned fixes, by priority. Check it before "fixing" something that looks
  wrong: it may be a known, deliberately deferred gap.
- `RELEASING.md` (Polish) — versions, Conventional Commits, the release workflow.

## What this repo is

ShipScope Flags is a feature-flag management pilot: one place that shows and controls flag state per environment
(`test` → `qa` → `prod`) for several services, enforces promotion order and flag dependencies, and warns before a
flag is removed in a way that would silently change a service's behaviour.

Three npm workspaces, one version and one `package-lock.json` (`npm ci` in the root installs all of them):

- **API** — NestJS 12 in `src/` (root `package.json`), served under `/api`. State lives in PostgreSQL
  through Prisma 7 (`prisma/schema.prisma`, `DATABASE_URL`); demo data is loaded only on request (`npm run db:seed`).
  There is **no authentication** on the management API yet (see `docs/TODO.md`, P0).
- **Dashboard** — React 19 + Vite 8 + Tailwind 4 in `frontend/` (own `package.json`). `frontend/src/api/client.ts`
  calls the API; only when the API cannot be reached (network error, timeout, 502/503/504) does the dashboard switch to
  the demo data from `@shipscope/shared/seed` (demo mode, with a banner). An error answer (409 from the rules, 400,
  500) is shown to the user, never treated as success. With the API every change (toggles, create, details, service
  bindings, retire, settings) waits for the server and shows what it stored; in demo mode changes stay in the browser.
- **Shared package** — `@shipscope/shared` in `packages/shared/`: the domain types (`types`), the business rules
  (`rules`) and the demo data (`seed`). The dashboard uses its TypeScript sources (export condition `source`, set in
  `frontend/vite.config.ts` and `tsconfig.app.json`); the API and Node use the compiled `packages/shared/dist`, built
  by `postinstall` and before `build`, `lint`, `typecheck` and the tests (`npm run build:shared`).

## Run it locally

- Database: `docker compose up -d db` (PostgreSQL on `127.0.0.1:5432`, plus the test database), then
  `npm run db:deploy` (migrations) and, after `npm run build`, `npm run db:seed` (demo data into an empty database).
- Install: `npm ci` in the repository root, once for all workspaces (never in `frontend/`).
- API: `npm run start:dev` → `http://localhost:3000/api`. It runs on the shared package's `dist`: when changing
  `packages/shared` meanwhile, keep `npm run dev -w @shipscope/shared` (tsc in watch mode) running too.
- Dashboard: `npm run dev -w frontend` → `http://localhost:5173`; Vite proxies `/api` to port 3000.
- Environment: copy `.env.example` to `.env` (the start scripts load it with `node --env-file-if-exists`) and
  `frontend/.env.example` to `frontend/.env`. Never commit a real `.env`.
- Whole stack in Docker: `docker compose up --build -d` → dashboard on `http://localhost:8080` (nginx serves the
  build and proxies `/api` to the API container), PostgreSQL on `127.0.0.1:5432`. A one-shot `migrate` service applies the
  migrations and loads the demo data into an empty database (`SEED_DEMO_DATA`). `docker compose down -v` also deletes
  the database volume.
- Node: see `engines` in both `package.json` files (backend `^22.22.3 || ^24.15.0 || >=26.0.0`).

## Layout

| Path                                                | What                                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/main.ts`, `src/app.module.ts`, `src/app.setup.ts` | Nest bootstrap; global prefix `api`, `helmet`, `trust proxy` (`TRUST_PROXY`); `app.setup.ts` is shared with the e2e tests |
| `src/health/health.controller.ts`                   | `GET /api/health`: 200 when the database answers, else 503 (Docker healthcheck)              |
| `src/rate-limit.ts`                                 | rate limits per client address and route (`@nestjs/throttler`, `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_SDK_PER_MINUTE`); `@SdkRoute()` marks the consumer route |
| `src/flags/*.controller.ts`                        | routes: `flags` (create/update/retire, `/:key/environments/:env`, `/:key/services/:id`), `services` (register, `/:id/credential`), `audit-log` (pages with a `before` cursor and filters), `settings` (`/settings/notifications`, `/settings/rules`), `sdk` (the consumer route `GET /v1/sdk/flags`, also at `/sdk/flags`) |
| `src/flags/flags.input.ts`                          | validation of management request bodies (400 with a readable reason, unknown fields rejected) |
| `src/flags/audit-retention.ts`                      | deletes audit entries older than `AUDIT_RETENTION_DAYS` (default 730, 0 = keep) once a day, noting it in the log |
| `src/flags/webhook.ts`                              | webhook URL checks against SSRF (https, no private/local addresses, `NOTIFY_WEBHOOK_HOSTS`) and masking |
| `src/flags/sdk-auth.ts`                             | who calls the consumer route: a service by its credential (only a SHA-256 digest is stored), or the deprecated shared `SDK_TOKEN` (constant-time) |
| `src/flags/flags.service.ts`                        | reads and changes state in PostgreSQL, rule checks, audit entries, webhook notifications     |
| `src/flags/flag-mapper.ts`                          | database rows ↔ the API shapes from `shared/types.ts`                                        |
| `prisma/schema.prisma`, `prisma/migrations/`        | database schema and its migrations; `prisma.config.ts` configures the CLI                    |
| `src/prisma/prisma.service.ts`                      | `PrismaService` (global Nest module); the client is generated into `src/generated/` (gitignored) |
| `src/db/load-state.ts`                              | loads demo data or an old `data/state.json` into an empty database (`db:seed`, `db:import`)  |
| `packages/shared/src/types.ts`                      | domain types used by the API and the dashboard (`@shipscope/shared/types`)                   |
| `packages/shared/src/rules.ts`                      | the business rules (promotion and disabling order, dependencies, stale detection, build-time checks, retirement, drift from per-environment check-ins, attention ranking) (`@shipscope/shared/rules`) |
| `packages/shared/src/seed.ts`                       | demo data: the dashboard's demo mode and `npm run db:seed` (`@shipscope/shared/seed`)        |
| `frontend/src/types.ts`, `lib/businessLogic.ts`, `data/mock.ts` | re-exports of the shared package, so dashboard code and tests import as before  |
| `frontend/src/state/store.tsx`, `state/useStore.ts` | client state and actions (React context): `StoreProvider`, and `useStore` with the store's shape |
| `sdk/`                                              | reference client for services (`client.ts`, no dependencies, run by Node as plain TypeScript); `node:test` tests (`npm run test:sdk`), its own `tsconfig.json` |
| `scripts/`                                          | tooling only: release scripts and their `node:test` tests                                    |
| `.github/workflows/`                                | `ci.yml` (PRs, and verify step of releases), `release.yml` (every push to `main`)            |
| `Dockerfile`, `docker-compose.yml`, `docker/`       | images `api` (Nest, prod deps only, user `node`), `migrate` and `web` (nginx, security headers incl. a strict CSP in `docker/security-headers.conf`); compose adds PostgreSQL; CI builds and smoke-tests them |

## Hard rules

- **Business rules live in one place**, `packages/shared/src/rules.ts`: the dashboard and the API both enforce
  them. Types and demo data live next to them. The package is plain TypeScript for both: inside it, relative
  imports end in `.js` (`./types.js`), and it depends on nothing at runtime. Never put copies of it anywhere else.
- **Backend imports are ESM with `nodenext`**: relative imports end in `.js` (`./flags.service.js`), and so do
  subpath imports of packages without an `exports` map (`supertest/types.js`). The frontend uses bundler resolution
  and imports without extensions.
- **Do not change the consumer contract casually.** `GET /api/v1/sdk/flags?env=…` with a service credential →
  `{ env, flags: { key: bool } }` is what services integrate against (PRD FR-011), documented in `docs/sdk-api.md`
  and `docs/sdk-api.openapi.json` (an e2e test checks real answers against it). Keep both in step; a breaking change needs a new version path and a
  `!` commit (see Commits).
- **Service credentials are shown once and never stored**: only `hashToken(...)` digests go to the database, and
  `toService` exposes neither. A rotation keeps the previous credential for `CREDENTIAL_GRACE_MS` (24 h).
- **Every schema change ships with its migration**: edit `prisma/schema.prisma`, run
  `npm run db:migrate -- --name <change>`, commit both; CI fails on a schema without its migration. Keep
  `flag-mapper.ts` in step, so the API keeps returning the shapes in `shared/types.ts`. Never edit an applied
  migration.
- **Flag state changes go through `FlagsService.setEnvironment`**: it takes a transaction-scoped advisory lock, so
  the rules (which read all flags) never see a half-applied concurrent change.
- **The server never fetches a user-supplied URL without `checkWebhookUrl`** (`webhook.ts`), right before the request
  and with `redirect: "manual"`; DNS can change between saving and sending. The stored webhook URL is a secret:
  responses carry `maskWebhookUrl(...)` only.
- No new npm dependency without a reason stated in the commit body; runtime dependencies are audited in CI.

## Checks (run before committing)

Root, in this order (CI runs the same):

```bash
npm run format:check   # Prettier over the whole repo (every workspace, configs, workflows)
npm run lint           # oxlint --type-aware on src/, test/, sdk/client.ts and packages/shared/src/
npm run typecheck      # tsc --noEmit on src/ and test/, then on sdk/
npm test               # vitest unit tests (src/**/*.spec.ts), service tests against TEST_DATABASE_URL
npm run test:e2e       # vitest e2e tests (test/**/*.e2e-spec.ts), against TEST_DATABASE_URL
npm run test:scripts   # node:test for scripts/
npm run test:sdk       # node:test for the reference client in sdk/
npm run build
```

Frontend: `npm run lint -w frontend && npm test -w frontend && npm run build -w frontend` (the build runs `tsc -b`
first, which also type-checks the tests). `npm run format` fixes formatting; `.editorconfig` covers the basics for editors.

## Code style

- TypeScript `strict` in every workspace. Prettier: double quotes, trailing commas, `printWidth` 160 (`.prettierrc`);
  lockfiles and Markdown are not formatted (`.prettierignore`).
- Match the surrounding code: compact one-line guards, small pure functions in `lib/`, comments only where the code
  cannot say why.
- Backend tests use Vitest with globals (`describe`, `it`, `expect`) and `@nestjs/testing`; script tests use
  `node:test` + `node:assert/strict`.
- Database tests use only `TEST_DATABASE_URL` (never `DATABASE_URL`: they truncate every table). `test/global-setup.ts`
  applies the migrations to it; `test/db.ts` gives `testPrisma()` and `resetDatabase()`. Test files run one at a time.
- Frontend tests use Vitest (jsdom, React Testing Library) with explicit imports from `vitest`, next to the code as
  `*.test.ts(x)` — never `*.spec.ts`, which the backend's Vitest collects across the whole repo. Build data with
  `frontend/src/test/factories.ts` and pin the clock (`vi.setSystemTime`) for date rules; mock `../api/client` in
  store tests.

## Commits, versions, releases

- Commit messages (and PR titles) follow Conventional Commits: `<type>(<scope>)!: <description>`, imperative, no
  trailing period, ≤ 72 characters. Scope is optional: `SHPFL`, `api`, `frontend`, `deps`, … Check one with
  `npm run lint:commit -- "fix(api): …"`; `npm run hooks:install` enables the local `commit-msg` hook.
- The type decides the release: `feat` → MINOR, `fix`/`perf` → PATCH, `!` or `BREAKING CHANGE:` → MAJOR (in 0.y.z:
  breaking → MINOR, everything else → PATCH); `docs`, `test`, `ci`, `build`, `chore`, `refactor`, `style` release
  nothing. Pick the type by the effect on users, not by the files touched.
- Every push to `main` runs `release.yml`: it may add a `chore(release): X.Y.Z` commit by `github-actions[bot]`, then
  tags `vX.Y.Z` and creates a GitHub Release. So **fetch and merge `origin/main` before pushing to it**, or the push is
  rejected.
- Do not edit `version` fields or `CHANGELOG.md` by hand; the workflow does that. Exception: a deliberate manual
  release (`npm run release -- <version>`, see `RELEASING.md`). Released tags are never moved or deleted.
