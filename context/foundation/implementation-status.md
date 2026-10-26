# Implementation status

Where each requirement of `prd.md` stands in the code, as of version 0.6 (2026-10-26). Update a row when a change
moves it; `docs/TODO.md` holds the planned work in detail. Status: **done**, **partial** (what is missing is named),
**open**.

## Functional requirements

| FR | Requirement (short) | Status | Where / what is missing |
| --- | --- | --- | --- |
| FR-001 | Log in via SSO (organization's identity provider) | open | Login screen is a placeholder; waits for the choice of identity provider (OIDC per `tech-stack.md`). |
| FR-002 | Break-glass login for an Admin | open | Waits for FR-001 and a decision on where the credential lives. |
| FR-003 | Admin registers a service and gets a credential; lists services | done | `POST /api/services`, Services tab. Admin-only in the UI only, until FR-001. |
| FR-004 | — | — | Not used in `prd.md`. |
| FR-005 | Admin revokes/rotates a service credential | done | `POST /api/services/:id/credential`: 24 h grace, or immediate revoke. |
| FR-006 | Create a flag typed `release` or `feature`; stale `release` flags flagged | partial | Done, but the stale threshold is fixed at 30 days; the PRD asks for a configurable one. |
| FR-007 | Assign a flag to services | done | At creation (`POST /api/flags`); bindings editable per service. |
| FR-008 | Set state per environment | done | `PATCH /api/flags/:key/environments/:env`, enforcing promotion order and dependencies on the server. |
| FR-009 | Matrix view grouped by service | open | The flag list shows services per flag, not flags per service. |
| FR-010 | Viewer sees but cannot change | partial | Enforced in the UI only; the API has no authentication yet (FR-001). |
| FR-011 | Service reads its assigned flags with its own credential | done | `GET /api/v1/sdk/flags`, contract in `docs/sdk-api.md`. |
| FR-012 | Client caches last-known state, works when the service is down | done | Reference client `sdk/client.ts` (memory + disk cache, defaults). Whether the 5 pilot services adopt it is Open Question 2. |
| FR-013 | Change reaches services within 60 s | done | Clients poll at most every 60 s (`docs/sdk-api.md`, `sdk/client.ts`); the dashboard flags a service that has not read a change. |
| FR-014 | Every state change in an audit log | partial | Logged on the server, paged and filtered; the actor still comes from the request until FR-001; retention is Open Question 1. |
| FR-015 | Flag change history in the dashboard | done | Flag panel "Recent history", Audit log tab. |
| FR-016 | Notifications on change, per flag or globally | partial | Global switch only, prod changes only, no retry. |
| FR-017 | Per flag and service: build-time or runtime read | done | Read mode and build-time values per binding (entered by hand), with mismatch warnings and retirement checks. |

## Business logic (`prd.md` → Business Logic)

| Rule | Status | Where |
| --- | --- | --- |
| 1. Stale detection | done | `isStaleCandidate` (threshold fixed, see FR-006). |
| 2. Promotion order | partial | `canEnable` blocks enabling out of order; disabling a lower environment while higher ones are on is still allowed (decision pending: block or cascade). |
| 3. Attention prioritization | done | `driftRisks` and `attentionItems`/`byAttention` from per-environment check-ins; default sort of the flag list. |

## Non-goals and open questions

Unchanged from `prd.md`. Open Question 1 (audit retention) and 2 (validating FR-012 across the pilot services) are
still open.
