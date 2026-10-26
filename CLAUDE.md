# CLAUDE.md

Guidance for Claude Code and other coding agents working in this repository. It states the rules the code relies on;
the history is in git and `CHANGELOG.md`. Related documents:

- `README.md` (Polish) — what the app does for users: flags, environments, rules, roles.
- `context/foundation/prd.md` — product requirements (FR-001…FR-017); `context/foundation/tech-stack.md` — the
  intended stack (NestJS + PostgreSQL/Prisma + OIDC; only NestJS exists so far).
- `docs/TODO.md` (Polish) — known gaps and planned fixes, by priority. Check it before "fixing" something that looks
  wrong: it may be a known, deliberately deferred gap.
- `RELEASING.md` (Polish) — versions, Conventional Commits, the release workflow.

## What this repo is

ShipScope Flags is a feature-flag management pilot: one place that shows and controls flag state per environment
(`test` → `qa` → `prod`) for several services, enforces promotion order and flag dependencies, and warns before a
flag is removed in a way that would silently change a service's behaviour.

Two packages, one version:

- **API** — NestJS 12 in `src/` (root `package.json`), served under `/api`. State lives in a JSON file
  (`FLAGS_DATA_FILE`, default `data/state.json`, gitignored), created from seed data on first start. There is no
  database and **no authentication** on the management API yet (see `docs/TODO.md`, P0).
- **Dashboard** — React 19 + Vite 8 + Tailwind 4 in `frontend/` (own `package.json`). `frontend/src/api/client.ts`
  calls the API and falls back to the fixture data in `frontend/src/data/mock.ts` whenever a request fails, so the UI
  also runs without the API. Many UI actions (create flag, edit bindings or metadata, retire) only change browser
  state; only environment toggles and notification settings reach the API.

## Run it locally

- API: `npm ci && npm run start:dev` in the repository root → `http://localhost:3000/api`.
- Dashboard: `cd frontend && npm ci && npm run dev` → `http://localhost:5173`; Vite proxies `/api` to port 3000.
- Environment: copy `.env.example` to `.env` (the start scripts load it with `node --env-file-if-exists`) and
  `frontend/.env.example` to `frontend/.env`. Never commit a real `.env`.
- Whole stack in Docker: `docker compose up --build -d` → dashboard on `http://localhost:8080` (nginx serves the
  build and proxies `/api` to the API container), PostgreSQL on `127.0.0.1:5432`. `docker compose down -v` also
  deletes the data volumes. The API gets `DATABASE_URL` but does not use PostgreSQL yet (still the JSON file, in the
  `flags-data` volume).
- Node: see `engines` in both `package.json` files (backend `^22.22.3 || ^24.15.0 || >=26.0.0`).

## Layout

| Path                                                | What                                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/main.ts`, `src/app.module.ts`                  | Nest bootstrap; global prefix `api`                                                          |
| `src/flags/flags.controller.ts`                     | management routes (`/flags`, `/services`, `/audit-log`, `/settings/notifications`) and the consumer route `GET /sdk/flags` |
| `src/flags/flags.service.ts`                        | state, persistence to the JSON file, rule checks, audit entries, webhook notifications       |
| `src/flags/shared/`                                 | **generated** copies of frontend files (see Hard rules)                                      |
| `frontend/src/types.ts`                             | domain types shared by both packages                                                          |
| `frontend/src/lib/businessLogic.ts`                 | the business rules (promotion order, dependencies, stale detection, build-time checks, retirement) |
| `frontend/src/state/store.tsx`                      | client state and actions (React context)                                                     |
| `scripts/`                                          | tooling only: `sync-shared.mjs`, release scripts and their `node:test` tests                 |
| `.github/workflows/`                                | `ci.yml` (PRs, and verify step of releases), `release.yml` (every push to `main`)            |
| `Dockerfile`, `docker-compose.yml`, `docker/`       | images `api` (Nest, prod deps only, user `node`) and `web` (nginx); compose adds PostgreSQL; CI builds and smoke-tests them |

## Hard rules

- **Never edit `src/flags/shared/*` by hand.** They are copies of `frontend/src/types.ts`,
  `frontend/src/lib/businessLogic.ts` and `frontend/src/data/mock.ts`, made by `npm run sync:shared` (also run by
  `prebuild`). Change the frontend file, run `npm run sync:shared`, commit both. CI fails when they differ.
- **Business rules live in one place**, `frontend/src/lib/businessLogic.ts`: the dashboard and the API both enforce
  them (the API through the shared copy). A rule change must keep both sides behaving the same.
- **Backend imports are ESM with `nodenext`**: relative imports end in `.js` (`./flags.service.js`), and so do
  subpath imports of packages without an `exports` map (`supertest/types.js`). The frontend uses bundler resolution
  and imports without extensions.
- **Do not change the consumer contract casually.** `GET /api/sdk/flags?env=…&service=…` → `{ env, flags: { key: bool } }`
  is what services integrate against (PRD FR-011). A breaking change needs a `!` commit (see Commits).
- No new npm dependency without a reason stated in the commit body; runtime dependencies are audited in CI.

## Checks (run before committing)

Root, in this order (CI runs the same):

```bash
npm run format:check   # Prettier over the whole repo (both packages, configs, workflows)
npm run sync:shared && git diff --exit-code -- src/flags/shared
npm run lint           # oxlint --type-aware on src/ and test/
npm run typecheck      # tsc --noEmit on src/ and test/
npm test               # vitest unit tests (src/**/*.spec.ts)
npm run test:e2e       # vitest e2e tests (test/**/*.e2e-spec.ts)
npm run test:scripts   # node:test for scripts/
npm run build
```

Frontend: `cd frontend && npm run lint && npm test && npm run build` (the build runs `tsc -b` first, which also
type-checks the tests). `npm run format` fixes formatting; `.editorconfig` covers the basics for editors.

## Code style

- TypeScript `strict` in both packages. Prettier: double quotes, trailing commas, `printWidth` 160 (`.prettierrc`);
  lockfiles and Markdown are not formatted (`.prettierignore`).
- Match the surrounding code: compact one-line guards, small pure functions in `lib/`, comments only where the code
  cannot say why.
- Backend tests use Vitest with globals (`describe`, `it`, `expect`) and `@nestjs/testing`; script tests use
  `node:test` + `node:assert/strict`.
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
