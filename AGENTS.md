# Repository Guidelines

ShipScope Flags is a feature-flag management pilot: a NestJS API in `src/` (state in a JSON file, served under `/api`)
and a React + Vite dashboard in `frontend/` (its own `package.json`), released together under one version. Product
scope: `@context/foundation/prd.md`; known gaps: `@docs/TODO.md`. Full depth lives in `@CLAUDE.md`.

## Hard rules

- Never edit `src/flags/shared/*` by hand: they are generated from `frontend/src/types.ts`,
  `frontend/src/lib/businessLogic.ts` and `frontend/src/data/mock.ts` by `npm run sync:shared`. Change the frontend
  file, run the script, commit both.
- Business rules live only in `frontend/src/lib/businessLogic.ts`; the dashboard and the API both enforce them.
- Backend imports are ESM (`nodenext`): relative imports end in `.js`.
- The consumer contract `GET /api/sdk/flags` is what services integrate against; change it only on purpose, with a
  breaking-change commit.

## Security

- Secrets only through environment variables; the repo holds only `.env.example` and `frontend/.env.example`. `.env`
  files and `data/` are gitignored.
- The management API has no authentication yet (`@docs/TODO.md`, P0): do not build features that assume it does.

## Build, test, and development

- API: `npm ci && npm run start:dev` (port 3000). Dashboard: `cd frontend && npm ci && npm run dev` (proxies `/api`).
- Before committing: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`,
  `npm run test:scripts`, `npm run build`, and in `frontend/`: `npm run lint && npm test && npm run build`.

## Coding style & testing

- TypeScript `strict` in both packages; Prettier with double quotes and `printWidth` 160 (`npm run format`).
- Backend tests: Vitest (`src/**/*.spec.ts`, `test/**/*.e2e-spec.ts`); script tests: `node:test`; frontend tests:
  Vitest + React Testing Library (`frontend/src/**/*.test.ts(x)`, never `*.spec.ts`).

## Commits & CI

- Commit messages and PR titles follow Conventional Commits (`fix(api): …`, scope optional, e.g. `SHPFL`); the type
  decides the next version (`@RELEASING.md`).
- `.github/workflows/ci.yml` runs on PRs; `release.yml` runs on every push to `main`, tests it, may add a
  `chore(release): X.Y.Z` commit and tags the release. Fetch and merge `origin/main` before pushing to it.
