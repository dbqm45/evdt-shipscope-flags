---
bootstrapped_at: 2026-09-18T18:16:30Z
starter_id: nestjs
starter_name: NestJS
project_name: shipscope-flags
language_family: js
package_manager: npm
cwd_strategy: subdir-then-move
bootstrapper_confidence: best-effort
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

```yaml
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
```

### Why this stack

TypeScript + NestJS + PostgreSQL (via Prisma) + Passport.js with an OIDC strategy. NestJS is strongly convention-based (decorators, modules, guards), which maps naturally onto the Viewer/Editor/Admin access model and the per-flag business rules (stale detection, promotion-order enforcement, attention prioritization) as guards/interceptors rather than ad-hoc logic. It is one of the most widely documented and widely used Node.js API frameworks, which matters for a 3-week solo build with AI-assisted coding — both the framework's own conventions and the volume of reference material reduce the number of from-scratch structural decisions needed. Prisma gives typed access to the Flag / Service / AuditLog data shapes implied by the PRD's Functional Requirements without committing to raw SQL or a heavier ORM. PostgreSQL is a safe, boring default for a system that must reliably hold audit history and flag state as the source of truth for production services.

`has_background_jobs: true` reflects the periodic stale-flag classification and attention-prioritization logic from the PRD's Business Logic section — these run independently of any single user request.

`ci_default_flow: manual-promotion` (rather than auto-deploy-on-merge) was chosen deliberately: this system becomes a dependency for 5 production services' flag state, so promoting to the production environment on a human decision, not automatically on merge, was judged the safer default given the guardrail that this service must never become an unreliable single point of failure.

`bootstrapper_confidence: best-effort` — this recommendation was reasoned directly rather than looked up in a bundled starter registry (the registry file was not available in the environment that wrote the hand-off), so it has not been verified end-to-end the way a registry-backed pick normally would be. Note: this run did find a project-local copy of the tech-stack-selector registry (`.claude/skills/10x-tech-stack-selector/references/starter-registry.yaml`), where the `nestjs` card is marked `bootstrapper_confidence: verified`. The hint value from the hand-off is carried forward verbatim per the consumer contract, but treat this pick as closer to `verified` than `best-effort` going forward.

## Pre-scaffold verification

| Signal      | Value                                    | Severity | Notes                                                                      |
| ----------- | ----------------------------------------- | -------- | --------------------------------------------------------------------------- |
| npm package | @nestjs/cli v12.0.3 published 2026-09-16  | fresh    | resolved pragmatically from `cmd_template` (`npx @nestjs/cli`, not a `create-*` pattern) |
| GitHub repo | not run                                   | —        | `docs_url` (https://docs.nestjs.com) is not a GitHub URL                    |

Recency: @nestjs/cli v12.0.3 published 2026-09-16 (fresh). No GitHub recency signal available. Proceeded.

## Scaffold log

**Resolved invocation**: `npx @nestjs/cli new .bootstrap-scaffold -p npm --strict --skip-git`
**Strategy**: scaffold into a temp directory then move files up (default)
**Exit code**: 0
**Files moved**: 12 paths moved silently (`.oxlintrc.json`, `.prettierrc`, `README.md`, `nest-cli.json`, `node_modules/`, `package-lock.json`, `src/`, `test/`, `tsconfig.build.json`, `tsconfig.json`, `vitest.config.e2e.ts`, `vitest.config.ts`)
**Conflicts (.scaffold siblings)**: `package.json` → `package.json.scaffold` (cwd already had a minimal placeholder `package.json`; existing wins per policy)
**.gitignore handling**: absent in scaffold (Nest CLI run with `--skip-git` did not generate one) — no merge needed
**.bootstrap-scaffold cleanup**: deleted

**Deviation worth flagging**: the Nest CLI's own internal `npm install --silent` step failed with a known npm/Arborist bug (`Cannot read properties of null (reading 'edgesOut')`, npm 10.9.8, triggered by the generated `vitest.config.ts`'s optional peer-dependency graph). The Nest CLI itself still exited 0 (it treats a failed internal install as non-fatal and prints "Packages installation failed!"). To leave the project in a working state, dependencies were installed manually with `npm install --legacy-peer-deps` inside the scaffold before the move-up — this succeeded (342 packages added, 343 audited). `node_modules/` and `package-lock.json` reflect that manual install.

**Action needed**: `package.json.scaffold` carries the real NestJS dependencies/scripts; the active `package.json` is still the pre-existing placeholder (`"main": "index.js"`, no NestJS deps, no scripts beyond a stub `test`). `node_modules/` was installed against the scaffold's `package.json`, not the active one. Reconcile before running anything — see Next steps.

## Post-scaffold audit

**Tool**: npm audit --json
**Summary**: 0 CRITICAL, 2 HIGH, 1 MODERATE, 2 LOW
**Direct vs transitive**: 0/0/0/0 direct of total 0/2/1/2 — all 5 findings are transitive (tool supports the `isDirect` distinction)

#### CRITICAL findings

None.

#### HIGH findings

- **tmp** (transitive, pulled in via `external-editor` → `inquirer` → Nest CLI chain), range `<=0.2.5`, fix available.
  - GHSA-52f5-9888-hmc6 — arbitrary temporary file/directory write via symbolic link `dir` parameter
  - GHSA-ph9p-34f9-6g65 — Path Traversal via unsanitized prefix/postfix enabling directory escape
- **undici** (transitive, via `@nestjs/mau`), range `<=6.27.0`, fix available.
  - 13 advisories in this range (insufficiently random values, unbounded decompression, request smuggling, WebSocket parser overflow, header/cookie injection variants, response-queue poisoning). Full list: GHSA-c76h-2ccp-4975, GHSA-g9mf-h72j-4rw9, GHSA-cxrh-j4jr-qwg3, GHSA-f269-vfmq-vjvj, GHSA-2mjp-6q6p-2qxm, GHSA-vrm6-8vpv-qv8q, GHSA-v9p9-hfj2-hcw8, GHSA-4992-7rv2-5pvq, GHSA-p88m-4jfj-68fv, GHSA-vxpw-j846-p89q, GHSA-g8m3-5g58-fq7m, GHSA-8xcm-r25x-g524, GHSA-m8rv-5g2x-5cg5, GHSA-v3r7-h72x-cjcm, GHSA-35p6-xmwp-9g52.

#### MODERATE findings

- **@nestjs/mau** (transitive, root-level optional Nest CLI dependency), range `*`, fix available — inherits severity from its `inquirer`/`undici` chain.

#### LOW / INFO findings

- **external-editor** (transitive, via `tmp`), range `>=1.1.1`, fix available.
- **inquirer** (transitive, via `external-editor`), range `3.0.0 - 8.2.6 || 9.0.0 - 9.3.7`, fix available.

All 5 findings sit in the Nest CLI's own optional tooling chain (`@nestjs/mau`, `inquirer`), not in the application's runtime dependencies. `npm audit fix` (non-force) should resolve them; not run automatically — bootstrapper informs, the user decides.

## Hints recorded but not acted on

| Hint                     | Value                                                                      |
| ------------------------ | --------------------------------------------------------------------------- |
| bootstrapper_confidence  | best-effort                                                                  |
| quality_override         | false                                                                        |
| path_taken               | standard                                                                     |
| self_check_answers       | null                                                                         |
| team_size                | solo                                                                         |
| deployment_target        | containerized (Docker), deployable to any standard container host — specific hosting target not yet chosen |
| ci_provider              | github-actions                                                               |
| ci_default_flow          | manual-promotion                                                             |
| has_auth                 | true                                                                         |
| has_payments             | false                                                                        |
| has_realtime             | false                                                                        |
| has_ai                   | false                                                                        |
| has_background_jobs      | true                                                                         |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — but it needs one manual reconciliation before it runs.

Useful manual steps:
- **Reconcile `package.json` vs `package.json.scaffold` first.** The active `package.json` is still your original placeholder; `package.json.scaffold` has the real NestJS scripts and dependency list that `node_modules/` was installed against. Diff them (`diff package.json package.json.scaffold`) and adopt the scaffold's dependencies/scripts (merging in anything you want to keep from the placeholder, e.g. the `name`/`description` fields), then delete `package.json.scaffold`.
- `git init` (if you have not already) to start your own repo history.
- Review any other `.scaffold` siblings the conflict policy created and decide which version of each file to keep.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log; all 5 are in the Nest CLI's own tooling chain, not your app's runtime deps.
