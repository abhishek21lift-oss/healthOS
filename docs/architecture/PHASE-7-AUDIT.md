# Phase 7 Audit — Timeline Projection + Permission-Aware Reads + Rebuild + Keyset Pagination + Security Proof

**Date:** 2026-09-24  
**Contract:** `docs/architecture/CONTRACT-v0.2.md` (**FROZEN**)  
**Scope:** Phase 7 only — timeline projection, outbox write-through, permission-aware list reads, deterministic rebuild/sync, HMAC keyset cursors, private-note/draft exclusion proof, Phase 0–6 regression.  
**Out of scope:** Phase 8 handoff closed loop, AI (Phases 9–10), Redis/Kafka, HTTP route layer, new authz model, OPA/Cedar, microservices, regulatory claims.  
**Authorization:** Phase 7 explicitly authorized after Phase 6 audit PASS.  
**Overall result:** **PASS**

---

## 1. Deliverables

| Artifact                                                | Location                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| Migration 0017 (timeline_entries + RLS + outbox insert) | `packages/database/migrations/0017_timeline_projection.sql`    |
| Migration 0018 (system SELECT on projection sources)    | `0018_timeline_system_read.sql`                                |
| Migration 0019 (system SELECT on timeline_entries)      | `0019_timeline_system_select.sql`                              |
| Migration 0020 (assessments amend UPDATE policy)        | `0020_assessments_amend_update.sql`                            |
| Domain timeline kinds (extended usage)                  | `packages/domain/src/timeline.ts`                              |
| Projection / rebuild / sync                             | `apps/api/src/timeline/project.ts`                             |
| Outbox drain                                            | `apps/api/src/timeline/outbox.ts`                              |
| Permission-aware list + keyset                          | `apps/api/src/timeline/query.ts`                               |
| HMAC cursor                                             | `apps/api/src/timeline/cursor.ts`                              |
| Types + deterministic ID                                | `apps/api/src/timeline/types.ts`                               |
| Clinical outbox hooks                                   | `observations.ts`, `assessments.ts`, `care.ts`, `documents.ts` |
| Integration suite (12 tests)                            | `apps/api/src/timeline/timeline.integration.test.ts`           |
| Architecture                                            | `docs/architecture/TIMELINE-ARCHITECTURE.md`                   |
| Security                                                | `docs/architecture/TIMELINE-SECURITY.md`                       |
| Projection                                              | `docs/architecture/TIMELINE-PROJECTION.md`                     |
| Pagination                                              | `docs/architecture/TIMELINE-PAGINATION.md`                     |
| This audit                                              | `docs/architecture/PHASE-7-AUDIT.md`                           |

---

## 2. Central acceptance criteria

| #   | Criterion                                                        | Result                                                        |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | Timeline is a read model only; never authorization source        | **PASS** — PEP before every list; membership unused for allow |
| 2   | Permission-aware reads: PEP `timeline_read` + RLS on every query | **PASS** — `listTimeline` dual gate; RLS matrix tests         |
| 3   | Private notes structurally excluded from projection              | **PASS** — type + CHECK + collector + guard + tests           |
| 4   | Drafts/unsigned assessments excluded                             | **PASS** — status filter + integration test                   |
| 5   | Revocation denies immediately (≤5s path unchanged from P5)       | **PASS** — PEP re-check each read; grant revoke regression    |
| 6   | Deterministic + idempotent rebuild                               | **PASS** — same source ⇒ same UUID; double rebuild parity     |
| 7   | Outbox write-through (ADR-0014) same-tx + drain                  | **PASS** — clinical hooks; outbox drain idempotent test       |
| 8   | Opaque HMAC person+filter-scoped keyset cursors                  | **PASS** — cross-person/filter cursor rejected                |
| 9   | Cross-person isolation (I-11)                                    | **PASS** — other person sees 0; PEP deny                      |
| 10  | Purpose fail-closed (I-19)                                       | **PASS** — empty purpose throws pre-DB                        |
| 11  | Phase 0–6 regression green                                       | **PASS** — 35 files / 371 tests                               |
| 12  | No architecture drift beyond declared Phase 7 scope              | **PASS** — §24 checklist                                      |

---

## 3. Security invariants — Phase 7 classification

| ID      | Phase 7 status          | Evidence                                                          |
| ------- | ----------------------- | ----------------------------------------------------------------- |
| I-1     | **PASS**                | PEP + RLS dual gate on every `listTimeline`; RLS direct SQL tests |
| I-2…I-3 | **PASS (unchanged P5)** | consent/org rules untouched; full regression                      |
| I-4     | **PASS**                | private notes never projected; six-layer exclusion                |
| I-5     | **PASS**                | projection validator + integration proof (no private source/body) |
| I-6…I-8 | N/A (no AI)             | boundaries unchanged                                              |
| I-9     | **PASS**                | PEP re-authorizes each read; revoke path regression               |
| I-10    | **PASS**                | PEP audits timeline allow/deny                                    |
| I-11    | **PASS**                | cross-person list denied; RLS 0 rows                              |
| I-16    | **PASS (convention)**   | no PHI in logs/cursor/payload                                     |
| I-19    | **PASS**                | purpose required before DB                                        |
| I-20    | **PASS (unchanged)**    | care team constraint regression                                   |

---

## 4. Architecture

```text
apps/api/src/timeline/*     → projection + query + cursor (Phase 7)
apps/api/src/clinical/*     → outbox enqueue on write (hook only)
apps/api/src/authorization  → Phase 5 PEP (sole semantic source)
packages/database           → 0017–0020 migrations + RLS
PostgreSQL RLS              → independent gate on timeline_entries + sources
```

No contract/ADR amendment. `DOMAIN_CONTRACT_VERSION` unchanged.

---

## 5. Quality gates

| Gate                                | Result                                                    |
| ----------------------------------- | --------------------------------------------------------- |
| `pnpm format` / `format:check`      | PASS                                                      |
| `pnpm lint`                         | PASS                                                      |
| `pnpm typecheck` + `typecheck:root` | PASS                                                      |
| `pnpm test`                         | PASS (**35 files / 371 tests** — prior baseline 34 / 359) |
| `pnpm boundaries`                   | PASS                                                      |
| `pnpm build`                        | PASS                                                      |
| `pnpm deps:audit`                   | PASS (0 vulnerabilities)                                  |
| `pnpm verify`                       | PASS                                                      |

No `any`, `@ts-ignore`, `eslint-disable`, `continue-on-error`, skipped security tests.

---

## 6. Phase 0–6 regression

| Suite                           | Result                                                   |
| ------------------------------- | -------------------------------------------------------- |
| Phase 2 RLS                     | PASS                                                     |
| Phase 3 auth                    | PASS                                                     |
| Phase 4 collaboration           | PASS                                                     |
| Phase 5 consent + authorization | PASS                                                     |
| Phase 6 clinical (4 suites)     | PASS (incl. updated signed-assessment immutability path) |
| Timeline (Phase 7)              | PASS (12/12)                                             |
| Full `pnpm test`                | **35 / 35 files, 371 / 371 tests**                       |

---

## 7. §24 architecture-drift checklist

| Check                                             | Result                  |
| ------------------------------------------------- | ----------------------- |
| Frozen contract not rewritten                     | PASS                    |
| No Phase 8+ features                              | PASS                    |
| No AI runtime                                     | PASS                    |
| No Redis/Kafka/microservices                      | PASS                    |
| No new authz engine                               | PASS (Phase 5 PEP only) |
| Boundaries package rules                          | PASS                    |
| Migrations additive only (0017–0020)              | PASS                    |
| Private notes still excluded from shared surfaces | PASS                    |

---

## 8. Known gaps / next before Phase 8

1. Git init + first CI run still open (Phase 0 F-1).
2. HTTP route layer still not exposed (service layer only by design).
3. Production object storage still port-only.
4. Explicit human authorization required for **Phase 8**.

---

## Scorecard

```text
Migration 0017 timeline table + RLS          PASS
Migration 0018 system source SELECT          PASS
Migration 0019 system timeline SELECT        PASS
Migration 0020 assessments amend UPDATE      PASS
Projection sources + exclusions              PASS
Private-note structural exclusion (I-4/I-5)  PASS
Draft/unsigned assessment exclusion          PASS
Outbox write-through + idempotent drain      PASS
Deterministic identity + rebuild parity      PASS
Permission-aware list (PEP + RLS)            PASS
Keyset pagination + HMAC cursor              PASS
Cross-person isolation (I-11)                PASS
Purpose fail-closed (I-19)                   PASS
Revocation re-check on read (I-9)            PASS
Phase 0–6 full regression                    PASS (35/371)
Quality gates (verify)                       PASS
Architecture violations                      NONE
Phase 8                                      NOT STARTED
STOP                                         YES
```

**PHASE 7 COMPLETE — READY FOR PHASE 8 AUTHORIZATION**
