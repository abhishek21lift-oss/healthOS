# Phase 2 Audit — Database + PostgreSQL + RLS

**Date:** 2026-09-22  
**Contract:** `docs/architecture/CONTRACT-v0.2.md` (**FROZEN**)  
**Scope:** Phase 2 only — schema, migrations, RLS, persistence boundary. No auth flows, HTTP, UI, AI, email, production deploy, or real health data.  
**Overall result:** **PASS**

---

## 1. Deliverables

| Artifact                  | Location                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| SQL migrations (10)       | `packages/database/migrations/0001_roles.sql` … `0010_ownership.sql`                         |
| Migration runner          | `packages/database/src/migrate.ts`                                                           |
| Pool + session context    | `packages/database/src/pool.ts`                                                              |
| Row→domain mappers        | `packages/database/src/mappers.ts`                                                           |
| Synthetic fixture         | `packages/database/src/fixture.ts`                                                           |
| Direct-SQL RLS tests      | `packages/database/src/rls.test.ts` (28 tests)                                               |
| Package smoke tests       | `packages/database/src/index.test.ts`                                                        |
| Architecture doc          | `docs/architecture/DATABASE-ARCHITECTURE.md`                                                 |
| RLS model doc             | `docs/security/RLS-MODEL.md`                                                                 |
| Freeze tests updated      | `tests/architecture/phase0-freeze.test.ts` (SQL/`pg` allowed only under `packages/database`) |
| CI PostgreSQL service     | `.github/workflows/ci.yml` (postgres:16, port 5433)                                          |
| Vitest `database` project | `vitest.config.ts` (180s timeouts; unit excludes database)                                   |

---

## 2. Role model (ADR-0008)

| Role                        | Superuser | BYPASSRLS | Owns health tables      |
| --------------------------- | --------- | --------- | ----------------------- |
| `postgres` (migrator/tests) | yes       | implicit  | no (transfers to owner) |
| `health_owner`              | no        | no        | yes                     |
| `health_app`                | no        | no        | no                      |

Verified in tests: `health_app` is not superuser, not BYPASSRLS; `observations` owner is `health_owner`.  
`FORCE ROW LEVEL SECURITY` on 9 health-bearing tables (observations, assessments, goals, care_plans, interventions, outcomes, private_professional_notes, consents, access_grants).

---

## 3. Security invariants — Phase 2 classification

| ID        | Invariant                                                             | Phase 2 status        | Evidence                                                                             |
| --------- | --------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------ |
| I-1       | No health read without principal ∧ membership ∧ AccessGrant ∧ purpose | **ENFORCED (RLS)**    | `rls.test.ts`: no context deny; nurse without grant deny; purpose mismatch deny      |
| I-2       | Person is sole consent grantor/revoker                                | **STRUCTURAL**        | `consent_revisions` insert WITH CHECK issued_by=person; no org grantor path          |
| I-3       | Org role never authorizes health reads                                | **ENFORCED (RLS)**    | org admin without care team/grant → 0 rows; org membership not in health policies    |
| I-4       | Private notes readable only by author                                 | **ENFORCED (RLS)**    | author read=1; peer professional=0; person=0; no context=0                           |
| I-5       | Private notes never in shared timeline/handoff                        | **STRUCTURAL**        | `handoff_items.ref_kind` CHECK excludes private_note                                 |
| I-6…I-8   | AI red lines                                                          | N/A Phase 2           | no AI code                                                                           |
| I-9       | Revoke ⇒ deny ≤ 5s                                                    | **ENFORCED (RLS)**    | grant revoke → next query 0 rows; membership end → 0 rows                            |
| I-10      | Audit immutable to app role; health access audited                    | **ENFORCED**          | no UPDATE/DELETE grants; immutability triggers (incl. superuser); insert path tested |
| I-11      | Cross-person access ⇒ 404                                             | **PARTIAL (DB deny)** | cross-person SELECT → 0 rows; HTTP 404 is Phase 5+                                   |
| I-12…I-19 | Notifications, secrets, export, invite, AI purpose                    | Later / N/A           | documented gap until those phases                                                    |
| I-20      | One open care team per person                                         | **ENFORCED**          | partial unique index; insert second open team rejected                               |

---

## 4. Executable proof summary (direct SQL, no mocks)

Tests connect as **`health_app`** against real PostgreSQL 16 (`health-os-pg-test:5433`):

1. Default deny without session context (observations, assessments, private notes)
2. Person self-only visibility; cross-person probe returns 0 rows
3. Professional formula: membership ∧ active AccessGrant ∧ purpose match
4. Care-team membership alone insufficient (I-1)
5. Org membership alone insufficient (I-3)
6. Immediate deny on grant revoke and membership end (I-9)
7. Private notes author-only including peer with full health grants (I-4)
8. Audit/consent history immutable to app and superuser (I-10)
9. One open care team per person (I-20)
10. Role hardening + FORCE RLS catalog checks

**Result: 28/28 RLS integration tests PASS.**

---

## 5. Quality gates

| Gate             | Command                                  | Result                                            |
| ---------------- | ---------------------------------------- | ------------------------------------------------- |
| Format           | `pnpm format:check`                      | PASS                                              |
| Lint             | `pnpm lint`                              | PASS                                              |
| Typecheck        | `pnpm typecheck` + `pnpm typecheck:root` | PASS (15/15 + root)                               |
| Tests            | `pnpm test`                              | **PASS — 140/140** (20 files; includes 28 DB RLS) |
| Boundaries       | `pnpm boundaries`                        | PASS (49 modules, 0 violations)                   |
| Build            | `pnpm build`                             | PASS (9/9)                                        |
| Dependency audit | `pnpm deps:audit`                        | PASS (0 vulnerabilities)                          |
| Canonical        | `pnpm verify`                            | PASS                                              |

No `any`, no `@ts-ignore`, no `eslint-disable`, no `continue-on-error`.

---

## 6. Deviations / notes

| Item                                                          | Disposition                                                                                                                                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 freeze tests originally banned all `.sql`/`pg`        | **Updated under Phase 2 authorization**: SQL only in `packages/database/migrations`; `pg` only in that package’s package.json; still bans prisma/drizzle/AI/redis/etc. everywhere |
| `apps/api` shell status now `phase: 2`, `databaseReady: true` | Reflects Phase 2; still `httpListening: false`, `authReady: false`                                                                                                                |
| Root accidentally had `pg` dependency                         | Removed; `pg` lives only in `@health-os/database`                                                                                                                                 |
| Local Docker `health-os-pg-test` on 5433                      | Dev/test only; CI uses ephemeral postgres service                                                                                                                                 |
| Fixture seed uses superuser + TRUNCATE on immutable tables    | Setup bypass is intentional; app role never gets that path                                                                                                                        |

---

## 7. Out of scope (unchanged)

- Authentication, sessions, password/token flows
- HTTP routes, CORS, API versioning
- Full PEP pipeline (`packages/permissions`)
- Timeline projection, outbox workers, notifications
- AI / context broker
- UI
- Production deployment, encryption/KMS, backup
- Real health data

---

## 8. Unresolved before Phase 3

1. **Git init + initial commit** (Phase 0 F-1 still open) — required for real CI on remote.
2. First green GitHub Actions run with new postgres service (workflow unproven until push).
3. Explicit human authorization for Phase 3.

None require a contract/ADR amendment.

---

## Scorecard

```text
Schema + migrations              PASS (10 ordered SQL files)
Role separation (ADR-0008)       PASS (owner / app / migrator)
RLS enabled + FORCE              PASS
Default deny without context     PASS
Access formula (I-1/I-3)         PASS
Private notes author-only (I-4)  PASS
Revocation immediacy (I-9)       PASS
Audit immutability (I-10)        PASS
One open care team (I-20)        PASS
Direct-SQL integration tests     PASS (28/28)
Architecture docs                PASS (DATABASE-ARCHITECTURE, RLS-MODEL)
Quality gates                    PASS (140/140 tests, verify green)
Architecture violations          NONE
Phase 3                          NOT STARTED
STOP                             YES
```

---

## Next authorized phase

**Phase 3** — requires **separate explicit authorization** after this audit.

**Do not start Phase 3+ features without that authorization.**
