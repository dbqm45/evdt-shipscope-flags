# Repository Guidelines

ShipScope Flags is a feature-flag management pilot: a NestJS API in `src/` (state in PostgreSQL through Prisma, served under `/api`)
and a React + Vite dashboard in `frontend/`, with the shared types and rules in `packages/shared/` (npm workspaces, one lockfile), released together under one version. Product
scope: `@context/foundation/prd.md`; known gaps: `@docs/TODO.md`. Full depth lives in `@CLAUDE.md`.

## Hard rules

- Business rules, domain types and demo data live only in the workspace package `@shipscope/shared`
  (`packages/shared/src/`); the dashboard (from its sources) and the API (from its `dist`) both use it.
- Backend imports are ESM (`nodenext`): relative imports end in `.js`.
- The consumer contract `GET /api/v1/sdk/flags` (`docs/sdk-api.md`, `docs/sdk-api.openapi.json`) is what services integrate against; change it
  only on purpose, with a new version path and a breaking-change commit.

## Security

- Every route is rate limited per client address (`src/rate-limit.ts`, 429 + Retry-After); behind a proxy the API
  needs `TRUST_PROXY`. `GET /api/health` is exempt.
- Secrets only through environment variables; the repo holds only `.env.example` and `frontend/.env.example`. `.env`
  files and `data/` are gitignored.
- The management API has no authentication yet (`@docs/TODO.md`, P0): do not build features that assume it does.
- `GET /api/v1/sdk/flags` needs a service credential (or the deprecated shared `SDK_TOKEN`), 401 otherwise. Service
  credentials are shown once; only their SHA-256 digests are stored and they never appear in responses. Webhook URLs
  go through `checkWebhookUrl` (`src/flags/webhook.ts`) before every request and are only ever returned masked.

## Build, test, and development

- One `npm ci` in the root installs every workspace. API: `npm run start:dev` (port 3000). Dashboard:
  `npm run dev -w frontend` (proxies `/api`).
- Docker: `docker compose up --build -d` runs PostgreSQL, the migrations (with demo data), the API and the dashboard
  (`http://localhost:8080`); `docker compose up -d db` starts only the database.
- Database: schema in `prisma/schema.prisma`; every change ships with a migration (`npm run db:migrate -- --name …`).
  Backend tests need `TEST_DATABASE_URL` (see `.env.example`) and truncate that database.
- Before committing: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`,
  `npm run test:scripts`, `npm run test:sdk`, `npm run build`, and for the dashboard: `npm run lint -w frontend && npm test -w frontend && npm run build -w frontend`.

## Coding style & testing

- TypeScript `strict` in both packages; Prettier with double quotes and `printWidth` 160 (`npm run format`).
- Backend tests: Vitest (`src/**/*.spec.ts`, `test/**/*.e2e-spec.ts`); script tests: `node:test`; frontend tests:
  Vitest + React Testing Library (`frontend/src/**/*.test.ts(x)`, never `*.spec.ts`).

## Commits & CI

- Commit messages and PR titles follow Conventional Commits (`fix(api): …`, scope optional, e.g. `SHPFL`); the type
  decides the next version (`@RELEASING.md`).
- `.github/workflows/ci.yml` runs on PRs; `release.yml` runs on every push to `main`, tests it, may add a
  `chore(release): X.Y.Z` commit and tags the release. Fetch and merge `origin/main` before pushing to it.
