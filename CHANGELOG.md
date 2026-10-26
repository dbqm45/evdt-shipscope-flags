# Changelog

Notable changes to ShipScope Flags, newest first. Versions follow [Semantic Versioning](https://semver.org/) and are
released automatically from [Conventional Commits](https://www.conventionalcommits.org/) (see `RELEASING.md`).

## [0.2.3] - 2026-10-26

### Added

- **api:** create, edit and retire flags through the API

### Fixed

- **frontend:** let dialogs scroll when they are taller than the window

## [0.2.2] - 2026-10-26

### Fixed

- **frontend:** show API errors instead of pretending changes were saved

## [0.2.1] - 2026-10-26

### Fixed

- **deps:** bump the frontend group with 11 updates (#2)
- **deps:** bump the backend group, keeping TypeScript 6 (#3)

## [0.2.0] - 2026-10-26

The API now stores its state in PostgreSQL (through Prisma) instead of a JSON file. To upgrade:

1. Set `DATABASE_URL` to a PostgreSQL database (see `.env.example`); `FLAGS_DATA_FILE` is no longer read.
   With Docker, `docker compose up -d db` starts one.
2. Create the tables: `npm run db:deploy`.
3. Move the existing state over, once, into the empty database: `npm run build`, then
   `npm run db:import -- data/state.json` (or `npm run db:seed` for the demo data instead).

With `docker compose up`, the `migrate` service runs step 2 and loads the demo data into an empty database. To import
an old state file instead, start only the database (`docker compose up -d db`), run steps 2 and 3 against it, then
start the rest of the stack; the demo data is skipped because the database is no longer empty.

### Breaking

- **api:** store state in PostgreSQL through Prisma

### Fixed

- **deps:** update dev tooling with security fixes (source-map-js, fast-uri, Vite)

## [0.1.0] - 2026-10-26

First versioned release: the state of the pilot as it is today.

### Added

- **SHPFL:** flag dashboard (React) with per-environment toggles, promotion order test → qa → prod, flag
  dependencies, build-time vs runtime checks, safe retirement and an audit log
- **SHPFL:** NestJS API: flag list, environment toggles with server-side rules, audit log, prod change notifications
  to a Slack-compatible webhook and the consumer endpoint `GET /api/sdk/flags`

### Fixed

- **deps:** patch high-severity advisories in runtime dependencies (body-parser, multer)
- track `frontend/src/data/mock.ts` by anchoring the `data/` ignore rule to the repository root
