---
project: shipscope-flags
version: 1
status: draft
created: 2026-09-18
context_type: greenfield
product_type: api
target_scale:
  users: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: false
---

## Vision & Problem Statement

Engineering teams maintaining paired/grouped production services (e.g. a frontend and a backend consuming the same conceptual flag) currently manage feature and release flags with no single source of truth. Flags live scattered across: build-time constants baked into application code, configuration files mixed in with unrelated settings, values deliberately hidden deeper for security reasons, and values fetched from a runtime endpoint. This fragmentation causes state drift between services — a flag flipped or removed in one service's source can leave a paired service holding a stale, contradictory state, silently making the feature unavailable to end users even though "the flag is on" from one service's point of view.

Every change or addition of a build-time flag currently forces a full application redeploy. There is also no distinction between release flags (short-lived, tied to a specific rollout) and feature flags (a different lifecycle/purpose) — this conflation adds further confusion about where a given flag "lives" and how long it should exist.

A related, sharper pain surfaced during discovery: a non-engineering (business) stakeholder cannot change a release flag's state themselves — every change, even one that is conceptually a business/product decision rather than a code decision, currently requires an engineer to make a deploy.

Pain categories confirmed by the user: coordination overhead (state drift between services), missing capability (no central system exists at all), workflow friction (build-time changes require a deploy), and decision paralysis (unclear where a given flag actually lives) — plus the business-self-service gap above.

Insight / why this hasn't been solved already: ready-made platforms were perceived as too expensive or too heavy to adopt for a first step.

## User & Persona

**Primary persona:** engineers who own and maintain production services within the organization — specifically those maintaining multiple services (e.g. frontend + backend pairs, or more) that share the same conceptual feature/release flags and are responsible for keeping flag state consistent across those services.

**Secondary actor raised during discovery (not in MVP scope):** a non-engineering / business stakeholder who wants to toggle a release flag's state without engineering involvement or a deploy. Deferred to v2 — see Non-Goals.

## Success Criteria

### Primary
The end-to-end flow works: an engineer (Admin role) logs in via single sign-on, registers two services (a frontend/backend pair), creates a flag tagged as either **release** or **feature** type, assigns it to both services, and sets its state per environment. Both services check the flag-status service on startup/periodically and cache the state locally. When the engineer changes the flag's state for an environment in the dashboard, both services read the same state on their next check — no drift between them — and the change is recorded in an audit log (who, when, what). A flag not yet migrated off build-time still requires a deploy to take effect when changed — MVP does not force every flag to convert on day one — but the system actively enables and encourages migrating a flag's read path from build-time-in-code to a runtime check, piloted first on one chosen service, with the eventual goal of migrating all flags across all pilot services to runtime reads. Confirmed shippable in ~3 weeks.

### Secondary
All three of the following, nice-to-have (not required to prove the primary flow works):
- Audit/history view per flag in the dashboard itself (not just raw logs)
- Flags grouped by service in one view (matrix-style)
- A notification on flag state change, sent to an external channel — as a toggle-able option, not always-on

### Guardrails
Both of the following must hold, always:
- The evaluation capability must never become a single point of failure — a consuming service must keep working (using its last locally-cached state) even when the flag service is unreachable.
- A flag state change must propagate to all consuming services within a reasonable time (e.g. under 60 seconds), not hours.

## User Stories

### US-01: Consistent flag state across two paired services
**Given** two registered services (a frontend and its paired backend) both assigned to the same flag,
**When** an Editor changes that flag's state for the `prod` environment in the dashboard,
**Then** the next time each service checks its flag state, both read the identical new state — no drift between them — and the change appears in the audit log with who made it and when.

## Functional Requirements

"Register a service" means: creating a `Service` entity in the system (a name/key, e.g. `evapl-service-frontend`); the system issues that service a credential in return, which the service uses to authenticate itself when checking flag state. A flag cannot be assigned to a service until the service exists this way.

### Authentication
- FR-001: A user (Viewer/Editor/Admin) can log in via single sign-on, through the organization's mandated identity provider. Priority: must-have
  > Socrates: No counter-argument considered viable. Resolution: kept as written — this is an organizational requirement, not a product choice up for debate.
- FR-002: An Admin can log in via break-glass fallback credentials when the identity provider is unavailable. Priority: must-have
  > Socrates: Counter-argument considered: "building this properly (secrets vault, activation audit) is its own mini-project — could blow the 3-week timeline." Resolution: kept, scoped minimally — reuse the organization's existing secrets vault for the break-glass credential; no new tooling built for this in MVP.

### Service management
- FR-003: An Admin can register a new service (name/key → system issues a credential) and view the list of registered services. Priority: must-have
  > Socrates: Counter-argument considered for the original separate "view list" FR: "trivial CRUD read, doesn't need its own FR." Resolution: folded into this FR — registration and listing are the same capability area.
- FR-005: An Admin can revoke/rotate a service's credential. Priority: must-have
  > Socrates: Counter-argument considered: "without the service auto-fetching the new credential, rotation breaks the service until a manual redeploy — contradicts the 'no deploy needed' goal." Resolution: kept, with a grace-period rule added — both old and new credentials stay valid for a defined window (e.g. 24h) after rotation, so the service picks up the new one on its own next restart/check instead of breaking immediately.

### Flag management
- FR-006: An Editor/Admin can create a flag, tagging its type as `release` or `feature` — the two types differ in system behavior: a `release` flag that has been ON in every environment for more than a configurable threshold is automatically flagged in the dashboard as "candidate for removal"; a `feature` flag has no such timer. Priority: must-have
  > Socrates: Counter-argument considered: "two flag types with no behavioral difference (both just ON/OFF) is just a label with no function." Resolution: revised — added the stale/candidate-for-removal timer as the concrete behavioral distinction for `release` flags.
- FR-007: An Editor/Admin can assign a flag to one or more registered services. Priority: must-have
  > Socrates: No counter-argument considered viable. Resolution: kept as written.
- FR-008: An Editor/Admin can set a flag's enabled/disabled state independently per environment (test/qa/prod). Priority: must-have
  > Socrates: No counter-argument considered viable, despite the flagged risk that this exact matrix (flag × environment × service) was real effort in a prior related internal tool. Resolution: kept as written; effort risk noted for downstream planning.
- FR-009: An Editor/Admin can view all flags grouped by service (matrix view). Priority: nice-to-have
  > Socrates: No counter-argument considered viable. Resolution: kept as written; scope-creep risk (building a large matrix instead of a simple table) noted for downstream planning.
- FR-010: A Viewer can see flags and their state but cannot change them. Priority: must-have
  > Socrates: Counter-argument considered: "with 5 services and a handful of engineers, is a read-only Viewer role needed from day one, or premature access-control complexity?" Resolution: kept as must-have — risk accepted, role stays.

### Evaluation (service-facing)
- FR-011: A registered service can fetch the current state of its assigned flags, authenticated with its own service credential. Priority: must-have
  > Socrates: No counter-argument volunteered. Noted as the single FR the whole MVP depends on — its contract should be locked carefully now rather than iterated after services integrate against it, since every consuming service would need updating on a later change.
- FR-012: A service's client caches the last-known flag state locally and continues serving it if the flag service is unreachable. Priority: must-have
  > Socrates: No counter-argument volunteered. Risk noted as an Open Question: building a proper local cache/fallback is real per-service engineering effort — with 5 pilot services potentially built differently, this could be the most underestimated FR in the set.

### Audit & notifications
- FR-013: A flag state change propagates to consuming services within 60 seconds via their next check. Priority: must-have
  > Socrates: Counter-argument considered: "60s via periodic checking averages ~30s latency but worst-case could run longer if check intervals vary — is this a hard SLA or an approximate target?" Resolution: clarified as a soft target — a recommended client check interval (≤60s), not a guaranteed system SLA.
- FR-014: Every flag state change is recorded in an audit log (who, when, what, old value, new value). Priority: must-have
  > Socrates: Counter-argument considered: "unlimited retention with no policy could become a storage/compliance concern later." Resolution: kept as written for MVP (no retention limit built); defining a retention policy is deferred and recorded as an Open Question before this scales beyond the pilot.
- FR-015: An Admin/Editor can view a flag's change history in the dashboard. Priority: nice-to-have
  > Socrates: No counter-argument considered viable. Resolution: kept as written.
- FR-016: An Admin can enable/disable a notification, sent to an external channel, on flag state change, per flag or globally. Priority: nice-to-have
  > Socrates: Counter-argument considered: "notifications are the most 'extra' of the three secondary items — a toggle (not just always-on) adds configuration surface for something already marked nice-to-have." Resolution: kept as written; flagged as the first thing to cut if the 3-week timeline is at risk.

### Migration (build-time → runtime)
- FR-017: The system tracks, per flag per service, whether that service currently reads the flag as build-time or via a runtime check — surfaced in the dashboard as migration progress (e.g. "3 of 5 services on runtime"). Priority: nice-to-have
  > Socrates: Counter-argument considered: "this is visibility, not the migration itself — the actual code change still happens per-service, outside this system's control." Resolution: kept as nice-to-have; the system tracks and surfaces progress, it does not perform the code migration for the service team.

## Non-Functional Requirements

- The evaluation capability's response time, as experienced by a consuming service, stays under 200ms p95.
- The system as a whole (dashboard + evaluation capability) is available 99.9% of the time.
- The system stores zero end-user data — only flag metadata and state. No end-user identifiers, sessions, or behavioral data ever pass through it.
- The evaluation capability is never a single point of failure for a consuming service, and a flag state change propagates to consumers within ~60 seconds.

## Business Logic

The system continuously classifies each flag's operational risk — surfacing release flags that have gone stale, blocking a flag from being enabled in a higher environment before it has proven itself in the one below, and ranking which flags need a human's attention first by how likely they are to be causing drift between the services that share them.

This rule has three parts:

1. **Stale detection (classification).** Input: per-environment ON/OFF state and the timestamp of the last change, for `release`-type flags only. Output: a "candidate for removal" label surfaced once a release flag has been ON in every environment for longer than a configurable threshold. The user encounters this as a badge next to the flag in the flag list and matrix view.

2. **Environment promotion order (workflow).** Input: the flag's current state in each environment, ordered test → qa → prod. Output: the system blocks or warns on an attempt to enable a flag in a higher environment if it has not first been enabled in the environment below it. The user encounters this as a blocked or warned action when trying to toggle a flag out of order.

3. **Attention prioritization.** Input: for each flag, its assigned services and whether their reported/cached state currently agrees (a drift-risk signal). Output: a ranked ordering that surfaces the flags most likely to be causing inconsistency first. The user encounters this as a default sort order or a "needs attention" section in the dashboard.

**Clarification on build-time flags:** for a flag that has NOT yet been migrated off build-time, MVP does not eliminate the deploy step required for that flag's change to take effect — that deploy still happens. But the system actively enables and encourages migrating a flag's read path from build-time-in-code to a runtime check — piloted first on one chosen service, with all pilot services eventually migrating. This migration is a deliberate, one-service-at-a-time rollout, not an automatic all-at-once conversion tool (see Non-Goals). Once a flag is migrated for a given service, that service no longer needs a deploy to pick up a state change for it.

## Access Control

- **Login:** Single sign-on via the organization's mandated identity provider, for all human users, with a break-glass fallback (local admin credentials, independent of the identity provider, stored offline, used only during an identity-provider outage) so the system is never fully locked out by an identity-provider incident.
- **Roles:** Viewer / Editor / Admin, flat across the whole system for MVP (not yet scoped per-service or per-project).
- **Business self-service toggle:** explicitly out of MVP scope — see Non-Goals. MVP users are engineers only.

## Non-Goals

- **Business self-service toggle.** Non-engineering stakeholders cannot change flag state in MVP; this is deferred to v2. Rationale: keeps MVP access control to a single (engineer) persona, avoiding a second UX/permission surface before the core flow is proven.
- **Gradual rollout percentage / per-user-segment targeting.** MVP flags are simple ON/OFF per environment, not percentage-based or user-segment-based. Rationale: the pain being solved is drift and centralization, not experimentation; percentage rollout is a distinct, larger feature.
- **Multi-project / multi-organization structure.** MVP has one flat set of registered services, not separate projects or tenant boundaries. Rationale: unnecessary complexity for a 5-service pilot; can be introduced later if the system scales beyond the pilot.
- **Automatic, all-at-once build-time-to-runtime conversion.** Migrating a flag's read path is a deliberate, one-service-at-a-time rollout done by each service's own team, not a tool that rewrites code or forces every flag to convert simultaneously.

## Open Questions

1. **What retention policy applies to the audit log?** — Currently unlimited/undefined for MVP. Needs a defined policy before the system scales meaningfully beyond the 5-service pilot. Block: no.
2. **How will the "service keeps working during an outage" guardrail (FR-012) be validated consistently across the 5 pilot services?** — Flagged during shaping as the most likely underestimated requirement, since the pilot services may not be built the same way. Block: no, but should be revisited early in implementation planning.
