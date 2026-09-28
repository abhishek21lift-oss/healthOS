# Phase 5 Audit — Consent + Policy + AccessGrant Compiler + AccessRequest + Revocation + Health Authorization Enforcement

**Date:** 2026-09-24  
**Contract:** `docs/architecture/CONTRACT-v0.2.md` (**FROZEN**)  
**Scope:** Phase 5 only — consent lifecycle, AccessGrant compiler, AccessRequest, application PEP, revolation propagation, Phase 5 RLS write policies + strengthened `can_read_health`.  
**Out of scope:** clinical workflows, timeline, AI, documents, handoff, messaging, public directory, wearables, FHIR/ABDM, billing, policy editor UI, OPA/Cedar, microservices, regulatory compliance claims.  
**Authorization:** Phase 5 explicitly authorized after Phase 4 audit PASS.  
**Overall result:** **PASS**

---

## 1. Deliverables

| Artifact                                           | Location                                                       |
| -------------------------------------------------- | -------------------------------------------------------------- |
| Migration 0015 (PEP RLS + write policies)          | `packages/database/migrations/0015_phase5_authorization.sql`   |
| Domain compiler (private-note exclusion)           | `packages/domain/src/access.ts`                                |
| Permissions PEP (Phase 5 evaluator)                | `packages/permissions/src/index.ts`                            |
| Permissions unit tests                             | `packages/permissions/src/index.test.ts`                       |
| Consent service                                    | `apps/api/src/consent/*`                                       |
| Authorization service (PEP + revocation + summary) | `apps/api/src/authorization/*`                                 |
| Consent integration tests                          | `apps/api/src/consent/consent.integration.test.ts`             |
| Authorization integration tests                    | `apps/api/src/authorization/authorization.integration.test.ts` |
| Membership-end grant revocation                    | `apps/api/src/collaboration/care-teams.ts`                     |
| Consent policy doc                                 | `docs/architecture/CONSENT-POLICY.md`                          |
| Authorization model doc                            | `docs/security/AUTHORIZATION-MODEL.md`                         |
| AccessGrant compiler doc                           | `docs/architecture/ACCESSGRANT-COMPILER.md`                    |
| This audit                                         | `docs/architecture/PHASE-5-AUDIT.md`                           |

---

## 2. Central acceptance criteria

| #   | Criterion                                                                                                   | Result   |
| --- | ----------------------------------------------------------------------------------------------------------- | -------- |
| 1   | Valid collaboration relationship **without** person-controlled consent + effective grant ⇒ no health access | **PASS** |
| 2   | PostgreSQL independently enforces consent+grant binding (`authz.can_read_health` + write policies)          | **PASS** |
| 3   | Person sole consent grantor/revoker (I-2); org admin / professional cannot issue consent                    | **PASS** |
| 4   | Revocation denies within ≤ 5 seconds (measured, not asserted)                                               | **PASS** |
| 5   | App ALLOW + DB DENY ⇒ DENY; no RLS bypass                                                                   | **PASS** |
| 6   | AccessRequest pending = zero health power; accept may materialize consent; reject grants nothing            | **PASS** |
| 7   | Private notes never compiled into ordinary AccessGrant (I-4)                                                | **PASS** |
| 8   | AI purpose/category binding deny (I-18) at PEP                                                              | **PASS** |
| 9   | Fail-closed unknown purpose/category/payload (I-19)                                                         | **PASS** |
| 10  | Org role never appears in health ALLOW predicates (I-3)                                                     | **PASS** |
| 11  | Membership end / care-team close revokes compiled grants (I-9 membership path)                              | **PASS** |
| 12  | Phase 2–4 regression green                                                                                  | **PASS** |

---

## 3. Security invariants — Phase 5 classification

| ID        | Phase 5 status      | Evidence                                                       |
| --------- | ------------------- | -------------------------------------------------------------- |
| I-1       | **PASS**            | PEP matrix: no grant/consent ⇒ deny; RLS dual gate             |
| I-2       | **PASS**            | professional issue/revoke rejected; person path only           |
| I-3       | **PASS**            | org membership never consulted for ALLOW                       |
| I-4       | **PASS**            | compiler skips `private_note_read`; PEP returns `PRIVATE_NOTE` |
| I-5       | N/A (no timeline)   | documented                                                     |
| I-6…I-8   | N/A (no AI runtime) | boundaries unchanged                                           |
| I-9       | **PASS**            | sync grant revoke; `measureRevocationLatency` ≤ 5000 ms        |
| I-10      | **PASS**            | PEP audits allow/deny; consent mutations write `audit_logs`    |
| I-11      | **PASS (service)**  | `PERSON_MISMATCH` cross-person deny; HTTP later                |
| I-12…I-16 | HOLD / later        | unchanged                                                      |
| I-17      | **PASS**            | Phase 3–4 regression                                           |
| I-18      | **PASS**            | `AI_CONTEXT_NOT_CONSENTED` deny                                |
| I-19      | **PASS**            | `UNKNOWN_*` / `PURPOSE_REQUIRED` fail-closed                   |
| I-20      | **PASS**            | Phase 2–4 regression                                           |

---

## 4. Architecture

```text
apps/api/src/consent        → person consent mutations + AccessRequest resolve
apps/api/src/authorization  → PEP (authorizeHealthAccess), compiler persist, revocation, summary
packages/permissions        → pure evaluateAuthorization / evaluateAuthorizationRequest
packages/domain             → pure compileAccessGrants / consent state machines
PostgreSQL RLS 0015         → independent second gate
```

No contract/ADR amendment. `PERMISSIONS_CONTRACT_VERSION` remains `0.2`. Legacy `evaluateHealthAccess` kept for Phase 1–4 regression.

---

## 5. Quality gates

| Gate                                     | Result |
| ---------------------------------------- | ------ |
| `pnpm format:check`                      | PASS   |
| `pnpm lint`                              | PASS   |
| `pnpm typecheck` + `pnpm typecheck:root` | PASS   |
| `pnpm test`                              | PASS   |
| `pnpm boundaries`                        | PASS   |
| `pnpm build`                             | PASS   |
| `pnpm deps:audit`                        | PASS   |
| `pnpm verify`                            | PASS   |

No `any`, `@ts-ignore`, `eslint-disable`, `continue-on-error`.

---

## 6. Known gaps / next before Phase 6

1. Git init + first CI run still open (Phase 0 F-1).
2. HTTP route layer for consent/authorization not exposed (service layer only by design).
3. Break-glass runtime path remains Phase 11 (function reserved in RLS).
4. Explicit human authorization required for **Phase 6**.

---

## Scorecard

```text
Migration 0015                     PASS
Consent issue/narrow/revoke        PASS
AccessGrant compiler (I-4)         PASS
AccessRequest lifecycle            PASS
PEP evaluateAuthorization          PASS
Dual gate app + RLS                PASS
Revocation ≤5s measured (I-9)      PASS
I-2 person sole grantor            PASS
I-3 org never ALLOW                PASS
I-18 AI binding deny               PASS
I-19 fail-closed                   PASS
Phase 2 RLS regression             PASS
Phase 3 auth regression            PASS
Phase 4 collaboration regression   PASS
Consent integration suite          PASS
Authorization integration suite    PASS
Architecture docs                  PASS (CONSENT-POLICY, AUTHORIZATION-MODEL, ACCESSGRANT-COMPILER)
Quality gates                      PASS (verify green)
Architecture violations            NONE
Phase 6                            NOT STARTED
STOP                               YES
```

---

## Next authorized phase

**Phase 6** — Clinical core + private notes + documents. Requires **separate explicit authorization** after this audit.

**Do not start Phase 6+ features without that authorization.**
