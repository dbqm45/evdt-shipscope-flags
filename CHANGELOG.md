# Changelog

Notable changes to ShipScope Flags, newest first. Versions follow [Semantic Versioning](https://semver.org/) and are
released automatically from [Conventional Commits](https://www.conventionalcommits.org/) (see `RELEASING.md`).

## [0.4.2] - 2026-10-26

### Fixed

- **frontend:** name services from the API, not from the demo data

## [0.4.1] - 2026-10-26

### Added

- **api:** add /api/health, security headers and rate limits

## [0.4.0] - 2026-10-26

Every service now reads flags with its own credential, and sees only the flags assigned to it. The contract is
versioned as `GET /api/v1/sdk/flags` and described in `docs/sdk-api.md`. To upgrade:

1. Deploy as usual; `npm run db:deploy` (or the `migrate` service) adds the credential columns. Existing services
   have no credential yet; services that send the shared `SDK_TOKEN` keep working.
2. As an Admin, open **Services** in the dashboard and press **Issue credential** for each service. The credential is
   shown once: store it in that service's secrets.
3. Make each service send `Authorization: Bearer <its credential>`, preferably to `/api/v1/sdk/flags`
   (`/api/sdk/flags` still works). Its **Last check-in** in the Services tab shows when it switched.
4. Once every service uses its own credential, remove `SDK_TOKEN` from the server. It is deprecated and will be
   removed in a later release.

Rotating a credential keeps the previous one working for 24 hours; **Revoke & reissue** ends it at once. Without
`SDK_TOKEN` the endpoint now answers 401 instead of 503 to anything but a service credential. `docker compose` no
longer sets the local shared token `local-sdk-token`: register a service in the dashboard to read flags from the
local stack.

### Added

- **api:** give each service its own SDK credential with rotation

## [0.3.0] - 2026-10-26

The consumer endpoint `GET /api/sdk/flags` now always needs a token. To upgrade:

1. Set `SDK_TOKEN` on the server to a long random value (e.g. `openssl rand -hex 32`). Without it the endpoint
   answers 503; services with a local cache keep serving their last known state.
2. Make every service that reads flags send `Authorization: Bearer <SDK_TOKEN>`. A wrong or missing token gets 401.
3. Webhooks for notifications must now be https and must not point to a private or local address. If yours goes to an
   internal chat server, list its host in `NOTIFY_WEBHOOK_HOSTS`. The API shows the saved webhook URL masked.

With `docker compose up`, the API uses the local token `local-sdk-token` unless `SDK_TOKEN` is set.

### Breaking

- **api:** require SDK_TOKEN for the consumer endpoint

### Fixed

- **api:** block SSRF through the notification webhook and mask its URL

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
