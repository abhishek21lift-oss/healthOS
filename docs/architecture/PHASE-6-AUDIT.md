# Phase 6 Audit — Clinical Core + Private Professional Notes + Documents

**Date:** 2026-09-24  
**Contract:** `docs/architecture/CONTRACT-v0.2.md` (**FROZEN**)  
**Scope:** Phase 6 only — clinical resource services (observations, assessments, goals, care plans, interventions, outcomes), private professional notes, documents.  
**Out of scope:** timeline projection, AI (broker, draft staging, contextual summary), handoff closed loop, messaging, public directory, wearables, FHIR/ABDM, billing, scheduling, HTTP route layer, real object storage, OPA/Cedar, microservices, regulatory compliance claims.  
**Authorization:** Phase 6 explicitly authorized after Phase 5 audit PASS.  
**Overall result:** **PASS**

---

## 1. Deliverables

| Artifact                                                                     | Location                                                     |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Migration 0016 (documents + clinical write RLS + person draft exclusion)     | `packages/database/migrations/0016_phase6_clinical.sql`      |
| Domain `Document` + lifecycle                                                | `packages/domain/src/document.ts` + `document.test.ts`       |
| Domain `Observation`                                                         | `packages/domain/src/observation.ts` + `observation.test.ts` |
| Domain id brands (`ObservationId`, `DocumentId`)                             | `packages/domain/src/ids.ts`                                 |
| Domain error codes (`INVALID_DOCUMENT_TRANSITION`, `DOCUMENT_NOT_AVAILABLE`) | `packages/domain/src/errors.ts`                              |
| Permissions: `sign` action                                                   | `packages/permissions/src/index.ts`                          |
| Clinical PEP helpers                                                         | `apps/api/src/clinical/pep.ts`                               |
| Clinical types / error mapping                                               | `apps/api/src/clinical/types.ts`                             |
| Observations service                                                         | `apps/api/src/clinical/observations.ts`                      |
| Assessments service (draft/sign/amend)                                       | `apps/api/src/clinical/assessments.ts`                       |
| Goals / care plans / interventions / outcomes                                | `apps/api/src/clinical/care.ts`                              |
| Private notes service (author-only + promotion)                              | `apps/api/src/clinical/private-notes.ts`                     |
| Documents service (upload/scan/download + storage port)                      | `apps/api/src/clinical/documents.ts`                         |
| Clinical integration suite                                                   | `apps/api/src/clinical/clinical.integration.test.ts`         |
| Private notes integration suite                                              | `apps/api/src/clinical/private-notes.integration.test.ts`    |
| Documents integration suite                                                  | `apps/api/src/clinical/documents.integration.test.ts`        |
| Clinical RLS matrix suite                                                    | `apps/api/src/clinical/clinical-rls.integration.test.ts`     |
| Clinical core doc                                                            | `docs/architecture/CLINICAL-CORE.md`                         |
| Private notes doc                                                            | `docs/architecture/PRIVATE-NOTES.md`                         |
| Document security doc                                                        | `docs/architecture/DOCUMENT-SECURITY.md`                     |
| Clinical data security doc                                                   | `docs/security/CLINICAL-DATA-SECURITY.md`                    |
| This audit                                                                   | `docs/architecture/PHASE-6-AUDIT.md`                         |

---

## 2. Central acceptance criteria

| #   | Criterion                                                                                                                                      | Result   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | Person-owned clinical resources (observations, assessments, goals, care plans, interventions, outcomes) serviceable with dual-gate enforcement | **PASS** |
| 2   | Every clinical operation flows through Phase 5 PEP `authorizeHealthAccess` (no independent clinical authz engine)                              | **PASS** |
| 3   | PostgreSQL RLS independently denies on every clinical table (0004/0016 policies)                                                               | **PASS** |
| 4   | Reads vs writes use distinct frozen categories; no generic `health_data`                                                                       | **PASS** |
| 5   | Assessment: human-only `sign`; signed content immutable (domain + DB trigger); amendment creates successor draft with lineage                  | **PASS** |
| 6   | Person principal never sees draft assessments (RLS + service filter)                                                                           | **PASS** |
| 7   | Private notes: author-only (PEP `PRIVATE_NOTE` + RLS author + service author assert); never ordinary-granted                                   | **PASS** |
| 8   | Private note promotion: author-only → shared assessment draft; original remains `PROFESSIONAL_PRIVATE`                                         | **PASS** |
| 9   | Documents: lifecycle + scan gate; quarantine terminal; no destructive delete; HIGH server-mediated; sha256 integrity                           | **PASS** |
| 10  | Purpose fail-closed at input boundary before any DB call                                                                                       | **PASS** |
| 11  | Category isolation; `sign` distinct action; `ai_context` deny path exists                                                                      | **PASS** |
| 12  | Cross-person access → deny / `not_found` (no existence oracle)                                                                                 | **PASS** |
| 13  | Org admin / organization role never grants clinical rows (I-3 regression)                                                                      | **PASS** |
| 14  | Phase 2–5 regression green (RLS 28, auth 21, collaboration 24, consent, authorization)                                                         | **PASS** |

---

## 3. Security invariants — Phase 6 classification

| ID        | Phase 6 status           | Evidence                                                                                                                      |
| --------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| I-1       | **PASS**                 | Dual gate: `authorizeClinical` → `authorizeHealthAccess` → `runClinicalAsPrincipal`; RLS matrix suite                         |
| I-2       | **PASS (P5)**            | Consent unchanged; person sole grantor regression green                                                                       |
| I-3       | **PASS**                 | Org role never in clinical ALLOW predicates; collaboration regression green                                                   |
| I-4       | **PASS**                 | Private notes: PEP `PRIVATE_NOTE` + RLS author + service author assert; compiler skip (P5) regression green; promotion matrix |
| I-5       | **PASS (structure)**     | `handoff_items.ref_kind` excludes private notes; domain exclusion; timeline projection still P7                               |
| I-6…I-8   | N/A (no AI runtime)      | boundaries unchanged; `ai_context` deny path tested                                                                           |
| I-9       | **PASS (P5)**            | Revocation ≤5s regression green                                                                                               |
| I-10      | **PASS**                 | PEP audits clinical allow/deny; promotion audit without body                                                                  |
| I-11      | **PASS (service + RLS)** | `PERSON_MISMATCH` / `not_found`; RLS 0 rows cross-person; HTTP 404 still P7                                                   |
| I-12…I-16 | HOLD / later             | unchanged (I-16: no PHI in clinical service logs — followed by convention)                                                    |
| I-17      | **PASS**                 | Phase 3–4 regression green                                                                                                    |
| I-18      | **PASS**                 | `AI_CONTEXT_NOT_CONSENTED` / `ai_context` deny path                                                                           |
| I-19      | **PASS**                 | `PURPOSE_REQUIRED`, `UNKNOWN_*`, empty category fail-closed                                                                   |
| I-20      | **PASS**                 | Unique open care team constraint regression green                                                                             |

---

## 4. Architecture

```text
apps/api/src/clinical/*     → service layer: requirePurpose + authorizeClinical (PEP) + runClinicalAsPrincipal (RLS)
apps/api/src/authorization  → Phase 5 PEP (authorizeHealthAccess) — sole semantic source
apps/api/src/consent        → consent mutations (unchanged; re-exported by authorization)
packages/permissions        → pure evaluateAuthorization (+ sign action)
packages/domain             → pure state machines (assessment sign/amend, document lifecycle, care transitions, private-note promotion)
packages/database           → 0016 migration: documents table, clinical write RLS, person draft exclusion
PostgreSQL RLS              → independent second gate (0004 + 0016 policies)
```

No contract/ADR amendment. `PERMISSIONS_CONTRACT_VERSION` remains `0.2`.

---

## 5. Quality gates

| Gate                                     | Result                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                      | PASS                                                                                                |
| `pnpm lint`                              | PASS                                                                                                |
| `pnpm typecheck` + `pnpm typecheck:root` | PASS                                                                                                |
| `pnpm test`                              | PASS (34 files / 359 tests — prior baseline 27 / 291; Phase 6 added clinical suites + domain tests) |
| `pnpm boundaries`                        | PASS                                                                                                |
| `pnpm build`                             | PASS                                                                                                |
| `pnpm deps:audit`                        | PASS                                                                                                |
| `pnpm verify`                            | PASS                                                                                                |

No `any`, `@ts-ignore`, `eslint-disable`, `continue-on-error`.

---

## 6. Known gaps / next before Phase 7

1. Git init + first CI run still open (Phase 0 F-1).
2. HTTP route layer for clinical services not exposed (service layer only by design).
3. `MemoryDocumentStorage` only — no production object storage (port frozen for later).
4. Timeline projection not implemented (Phase 7).
5. Explicit human authorization required for **Phase 7**.

---

## Scorecard

```text
Migration 0016                          PASS
Observations dual-gate                  PASS
Assessment sign/amend/immutability      PASS
Person draft exclusion                  PASS
Goals / care plans / interventions      PASS
Outcomes                                PASS
Private notes author-only (I-4)         PASS
Private note promotion                  PASS
Document lifecycle + quarantine         PASS
HIGH_SENSITIVITY server-mediated        PASS
No destructive delete                   PASS
Checksum integrity                      PASS
Purpose fail-closed (I-19)              PASS
Category isolation / sign action        PASS
Cross-person deny (I-11)                PASS
I-3 org never ALLOW                     PASS
Phase 2 RLS regression                  PASS
Phase 3 auth regression                 PASS
Phase 4 collaboration regression        PASS
Phase 5 consent + authorization regression PASS
Clinical integration suite              PASS
Private notes integration suite         PASS
Documents integration suite             PASS
Clinical RLS matrix suite               PASS
Domain unit tests (document/observation) PASS
Architecture docs                       PASS (CLINICAL-CORE, PRIVATE-NOTES, DOCUMENT-SECURITY, CLINICAL-DATA-SECURITY)
Quality gates                           PASS (verify green)
Architecture violations                 NONE
Phase 7                                 NOT STARTED
STOP                                    YES
```

---

## Next authorized phase

**Phase 7** — Timeline projection. Requires **separate explicit authorization** after this audit.

**Do not start Phase 7+ features without that authorization.**
