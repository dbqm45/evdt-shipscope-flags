# Changelog

Notable changes to ShipScope Flags, newest first. Versions follow [Semantic Versioning](https://semver.org/) and are
released automatically from [Conventional Commits](https://www.conventionalcommits.org/) (see `RELEASING.md`).

## [0.2.0] - 2026-10-26

### Breaking

- **api:** store state in PostgreSQL through Prisma

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
