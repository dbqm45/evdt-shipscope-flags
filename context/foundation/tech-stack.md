
---
starter_id: nestjs
package_manager: npm
project_name: shipscope-flags
hints:
  language_family: js
  team_size: solo
  deployment_target: containerized (Docker), deployable to any standard container host — specific hosting target not yet chosen
  ci_provider: github-actions
  ci_default_flow: manual-promotion
  bootstrapper_confidence: best-effort
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: true
---

## Why this stack

TypeScript + NestJS + PostgreSQL (via Prisma) + Passport.js with an OIDC strategy. NestJS is strongly convention-based (decorators, modules, guards), which maps naturally onto the Viewer/Editor/Admin access model and the per-flag business rules (stale detection, promotion-order enforcement, attention prioritization) as guards/interceptors rather than ad-hoc logic. It is one of the most widely documented and widely used Node.js API frameworks, which matters for a 3-week solo build with AI-assisted coding — both the framework's own conventions and the volume of reference material reduce the number of from-scratch structural decisions needed. Prisma gives typed access to the Flag / Service / AuditLog data shapes implied by the PRD's Functional Requirements without committing to raw SQL or a heavier ORM. PostgreSQL is a safe, boring default for a system that must reliably hold audit history and flag state as the source of truth for production services.

`has_background_jobs: true` reflects the periodic stale-flag classification and attention-prioritization logic from the PRD's Business Logic section — these run independently of any single user request.

`ci_default_flow: manual-promotion` (rather than auto-deploy-on-merge) was chosen deliberately: this system becomes a dependency for 5 production services' flag state, so promoting to the production environment on a human decision, not automatically on merge, was judged the safer default given the guardrail that this service must never become an unreliable single point of failure.

`bootstrapper_confidence: best-effort` — this recommendation was reasoned directly rather than looked up in a bundled starter registry (the registry file was not available in this environment), so it has not been verified end-to-end the way a registry-backed pick normally would be. Treat the first setup steps with a bit more scrutiny than a `verified` pick would need.

## Status (version 0.7)

- **In place:** TypeScript, NestJS, PostgreSQL through Prisma (with migrations checked in CI), Docker images and
  compose, GitHub Actions with automatic releases, OIDC sign-in for users (FR-001) with server-side sessions and roles
  enforced by the API; services authenticate with their own credentials (FR-003/005/011).
- **Not yet:** break-glass access (FR-002).
- **Differs from the plan:** sign-in uses `openid-client` in a small Nest module (`src/auth/`) instead of Passport.js:
  one flow (authorization code with PKCE) needs no strategy layer. Any OIDC provider works; Keycloak runs in docker
  compose for local tests. The stale and attention rules run when the dashboard renders (shared code in
  `packages/shared/src/rules.ts`), not as background jobs; nothing needs scheduling so far. Deployment is still
  manual: every push to `main` releases a version, but no environment deploys it automatically.

