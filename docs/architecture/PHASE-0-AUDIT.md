# Phase 0 Audit — Architecture Freeze + Repository Foundation

**Date:** 2026-09-22  
**Contract:** `docs/architecture/CONTRACT-v0.2.md` (**FROZEN**)  
**Scope:** Phase 0 only — no health features.  
**Overall result:** **PASS** (with notes)

---

## Verification evidence (run locally, same as CI)

| Gate                  | Command                          | Result                                              |
| --------------------- | -------------------------------- | --------------------------------------------------- |
| Install               | `pnpm install --frozen-lockfile` | PASS                                                |
| Format                | `pnpm format:check`              | PASS                                                |
| Lint                  | `pnpm lint`                      | PASS                                                |
| Typecheck (workspace) | `pnpm typecheck`                 | PASS (15/15 tasks)                                  |
| Typecheck (root)      | `pnpm typecheck:root`            | PASS                                                |
| Tests                 | `pnpm test`                      | PASS (11 files, 25 tests)                           |
| Boundaries            | `pnpm boundaries`                | PASS (24 modules, 30 deps, 0 violations)            |
| Build                 | `pnpm build`                     | PASS (9/9 packages)                                 |
| Dependency audit      | `pnpm deps:audit`                | PASS (0 known vulnerabilities after vitest ≥4.1.11) |
| **Canonical gate**    | **`pnpm verify`**                | **PASS**                                            |

Node `v26.9.0` (engines `>=22.18 <27`, `.nvmrc` = `22`), pnpm `12.4.2` (pinned via `packageManager`).

---

## Audit checklist vs Architecture & Domain Contract v0.2

### Repository structure — PASS

```text
apps/{web,api,worker} · packages/{domain,database,auth,permissions,validation,ui}
tooling/{tsconfig,eslint-config} · docs/{architecture,adr,security,api,runbooks}
tests/architecture · .github/workflows/ci.yml
package.json · pnpm-workspace.yaml · turbo.json · tsconfig.base.json
eslint.config.mjs · .dependency-cruiser.cjs · .env.example · README.md
```

Matches the Phase 0 target structure. Shells only; no feature code.

### Package boundaries — PASS

Declared workspace deps match CONTRACT-v0.2 §Package boundaries:

| Package     | Declared deps                                   | Contract |
| ----------- | ----------------------------------------------- | -------- |
| domain      | (none)                                          | OK       |
| validation  | (none required)                                 | OK       |
| permissions | domain                                          | OK       |
| database    | domain, validation                              | OK       |
| auth        | domain, validation                              | OK       |
| ui          | (none)                                          | OK       |
| api         | domain, database, auth, permissions, validation | OK       |
| worker      | domain, database, permissions, validation       | OK       |
| web         | ui, validation                                  | OK       |

### Dependency graph enforcement — PASS

- `.dependency-cruiser.cjs`: 13 forbidden rules + circular ban (domain purity, web→database, ui→permissions, auth≠authz, database⊥permissions/auth, validation-only-domain, app isolation).
- `pnpm boundaries` clean.
- Architecture tests (`tests/architecture/boundaries.test.ts`) run depcruise and assert package.json forbidden pairs.
- ESLint `no-restricted-imports` for domain and ui.

Forbidden edges checked: `web→database`, `domain→database`, `domain→framework`, `domain→AI`, `ui→permissions` — none present; config would fail CI if introduced.

### Security defaults — PASS (Phase 0 baseline only)

| Requirement                      | Status                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------- |
| No secrets committed             | PASS — only `.env.example`; `.gitignore` excludes `.env*`                    |
| Environment validation structure | PASS — `.env.example` skeleton with phase markers                            |
| No credentials in source/logs    | PASS — no auth/health code; no `process.env` in packages                     |
| No wildcard CORS                 | PASS — no HTTP server; allowlist comment recorded for API phase              |
| No insecure prod defaults        | PASS — apps are non-listening shells                                         |
| Dependency audit                 | PASS — `pnpm deps:audit`; vitest upgraded 3.x→4.1.11 for GHSA-82fw-gwwq-j7x9 |
| Lockfile                         | PASS — `pnpm-lock.yaml` present; frozen install works                        |
| Node/pnpm pinned                 | PASS — `.nvmrc`, `packageManager`, `engines`                                 |
| Reproducible install             | PASS — `pnpm install --frozen-lockfile`                                      |
| CI clean install                 | PASS — CI uses frozen lockfile                                               |

**Not provided (documented, by design):** runtime authorization, RLS, session security, key management, pen testing, regulatory validation. See `docs/security/SECURITY-INVARIANTS.md`.

### Documentation — PASS

| Artifact                                     | Status                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `docs/architecture/CONTRACT-v0.2.md`         | FROZEN                                                                                                   |
| `docs/architecture/ARCHITECTURE-STATUS.md`   | Present                                                                                                  |
| `docs/architecture/IMPLEMENTATION-PHASES.md` | Phase 0 = only authorized                                                                                |
| `docs/security/SECURITY-INVARIANTS.md`       | I-1…I-20 + Phase 0 enforcement map                                                                       |
| `docs/security/THREAT-MODEL.md`              | Phase 0 structural threats + deferred product threats                                                    |
| `docs/adr/README.md`                         | Index + binding ADR change control (6-step)                                                              |
| ADR-0001…0014                                | All present under `docs/adr/`                                                                            |
| `docs/api/README.md`                         | Placeholder (no endpoints)                                                                               |
| `docs/runbooks/README.md`                    | Placeholder (not production-ready)                                                                       |
| `README.md`                                  | What/principles/structure/setup/commands/gates/security/phase scope/governance; **no compliance claims** |

### ADR preservation / change control — PASS

- 14 ADRs preserved; core ADRs listed in change-control rule.
- Six required steps for core ADR/contract change documented; “implementation convenience is NOT sufficient.”
- No architecture redesign discovered; no contradiction requiring amendment.

### Forbidden functionality — PASS

Architecture freeze tests assert absence of:

- `.sql` / migration directories / schema dirs
- banned deps: `pg`, `prisma`, `drizzle`, `redis`, `kafkajs`, `openai`, `@ai-sdk/*`, `ai`, `fastify`, `express`, `next`, `react`, …
- domain importing `node:` / `pg` / workspace I/O packages
- committed `.env` other than `.env.example`
- CI: no `continue-on-error` on quality gates

Manual scan confirms: no clinical entities, no RLS, no auth runtime, no consent, no timeline, no AI calls, no UI features, no API health endpoints, no Redis/Kafka/microservices.

### CI — PASS

`.github/workflows/ci.yml`:

```text
checkout → pnpm 12.4.2 → Node from .nvmrc → frozen install
→ secret scan → format → lint → typecheck (+root) → test → boundaries → build → audit
```

- Fails on lint/TS/test/boundary/build/lockfile/secret/audit failures.
- No `continue-on-error` on quality steps.
- Local `pnpm verify` = same gate chain (verify omits secret scan + audit, which run as separate CI steps; both are documented commands).

### TypeScript strictness — PASS

`tsconfig.base.json`: `strict`, `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, plus `noImplicitReturns`, `noUnusedLocals/Parameters`, `verbatimModuleSyntax`, `isolatedModules`.

ESLint: `no-explicit-any: error`, strictTypeChecked + stylisticTypeChecked, no `@ts-ignore` in workspace sources.

### Test infrastructure — PASS

- Vitest projects: `unit` + `architecture`.
- Boundary tests prove forbidden edges are enforced (not documentation-only).
- Freeze tests prove Phase 0 exclusions.
- No fake health-domain tests (shell smoke tests only).

---

## Findings

| ID  | Severity | Finding                                                                                                                                | Disposition                                                                |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| F-1 | WARN     | Workspace is not a git repository yet (`git rev-parse` fails). Lockfile “committed” and GitHub CI require `git init` + initial commit. | Unresolved — initialize git and commit Phase 0 baseline before first push. |
| F-2 | PASS     | Moderate vitest advisory (GHSA-82fw-gwwq-j7x9) found during audit.                                                                     | Fixed — vitest `^4.1.11` across workspace; audit clean.                    |
| F-3 | PASS     | CI workflow was missing at session start.                                                                                              | Fixed — `.github/workflows/ci.yml` added.                                  |
| F-4 | WARN     | Root `tsconfig.json` is an empty project list (fine for per-package `tsc`, but IDE “solution” references are empty).                   | Acceptable for Phase 0; optional improvement later.                        |
| F-5 | WARN     | `pnpm verify` does not include `deps:audit` or secret scan (CI runs them as separate steps).                                           | Documented; both are required CI gates.                                    |
| F-6 | NOTE     | ESLint dependency reports deprecation of 9.39.x line upstream.                                                                         | Watch on next upgrade window; not a Phase 0 blocker.                       |

---

## Deviations from the Phase 0 brief

| Deviation                                                                                                                                                     | Rationale                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Added `pnpm format:check`, `pnpm typecheck:root`, `pnpm test:unit`, `pnpm test:architecture`, `pnpm deps:audit`, `pnpm clean` beyond the minimum command list | Required for deterministic local/CI parity and security baseline. |
| CI includes secret scan + dependency audit beyond install→…→build                                                                                             | Explicit security baseline requirements.                          |
| No application behavior beyond shell status functions                                                                                                         | Phase 0 forbids health features.                                  |

No architectural deviations. No ADR changes.

---

## Unresolved items (must clear before Phase 1)

1. **Git initialization + initial commit** of the Phase 0 tree (F-1), so lockfile and CI are real.
2. First green GitHub Actions run after push (CI file unproven until first remote run).
3. Explicit human authorization for Phase 1 (domain package work).

---

## Success criteria scorecard

```text
Architecture frozen              PASS
Repository reproducible          PASS (local); WARN until git init (F-1)
Package boundaries enforced      PASS
TypeScript strict                PASS
Lint clean                       PASS
Tests clean                      PASS (25/25)
Boundary tests clean             PASS
Build clean                      PASS
CI clean                         PASS (workflow present; first remote run pending)
Security baseline documented     PASS
Phase 0 audit PASS               PASS (this document)
STOP                             YES — Phase 1 not started
```

---

## Next authorized phase

**Phase 1 — Pure domain package** (entities, value objects, state machines, invariants)  
**Authorization state:** NOT YET GRANTED — requires explicit go after this audit.

**Do not start Phase 2+ (database, RLS, auth, consent, clinical, timeline, AI, UI, APIs).**
