# Clinical Core — Phase 6

**Normative references:** CONTRACT-v0.2 (clinical resources), ADR-0007 (layered PEP), ADR-0008 (RLS second gate), ADR-0012/0013 (human sign), SECURITY-INVARIANTS I-1, I-3, I-10, I-11, I-19.

## Purpose

Phase 6 exposes person-owned clinical resources — observations, assessments, goals, care plans, interventions, outcomes — through the frozen dual-gate authorization path. No independent authorization engine exists for clinical operations.

## Resources covered

| Resource     | Table           | Write category                                     | Domain module    |
| ------------ | --------------- | -------------------------------------------------- | ---------------- |
| Observation  | `observations`  | `timeline_read`                                    | `observation.ts` |
| Assessment   | `assessments`   | `assessment_write` (+`sign`)                       | `assessment.ts`  |
| Goal         | `goals`         | `goal_write`                                       | `care.ts`        |
| CarePlan     | `care_plans`    | `care_plan_write`                                  | `care.ts`        |
| Intervention | `interventions` | `care_plan_write`                                  | `care.ts`        |
| Outcome      | `outcomes`      | `care_plan_write` (or `goal_write` if goal-linked) | `care.ts`        |
| Document     | `documents`     | `document_read`                                    | `document.ts`    |

Reads use the matching `*_read` category. `sign` is a distinct action on `assessment_write`.

## Request flow (dual gate)

```text
Clinical service (apps/api/src/clinical/*)
  → authorizeClinical (pep.ts)
      → requirePurpose          — empty purpose → PURPOSE_REQUIRED (fail closed)
      → authorizeHealthAccess   — Phase 5 PEP (apps/api/src/authorization)
  → runClinicalAsPrincipal
      → PostgreSQL RLS          — independent second gate
  → health rows
```

App ALLOW + DB DENY ⇒ DENY. Never bypass RLS. Never treat app allow as sufficient.

## Category mapping (explicit)

| Operation                      | Action        | Category                                     |
| ------------------------------ | ------------- | -------------------------------------------- |
| Create/list observations       | read/write    | `timeline_read`                              |
| Create/update assessment draft | create/update | `assessment_write`                           |
| Sign assessment                | `sign`        | `assessment_write`                           |
| Amend assessment               | `amend`       | `assessment_write`                           |
| List assessments (person)      | read          | `assessment_read`                            |
| Create/update goal             | create/update | `goal_write`                                 |
| Create/update care plan        | create/update | `care_plan_write`                            |
| Create intervention            | create        | `care_plan_write`                            |
| Record outcome                 | create        | `care_plan_write` or `goal_write`            |
| Upload/list document           | create/read   | `document_read`                              |
| Private note operations        | n/a           | excluded (author-only; see PRIVATE-NOTES.md) |

No generic `health_data` category. Reads ≠ writes.

## Assessment lifecycle

```text
draft → signed → amended (successor draft)
```

- **Human-only sign** — `sign` action; machine actors rejected (`MACHINE_ACTOR_FORBIDDEN`).
- **Signed content immutable** — domain `updateAssessmentDraft` rejects; DB trigger `protect_signed_assessment` (0009) rejects even superuser UPDATE of title/body.
- **Amendment lineage** — predecessor status → `amended`; successor created as `draft` with `amendment_of` set.
- **Person draft exclusion** — person principal only sees `status != 'draft'` (RLS `assessments_select` AND service filter). Professionals see drafts under grant.

## Care plan domain states

```text
Goal:          proposed → active → achieved | abandoned
CarePlan:      draft → active → completed | cancelled
Intervention:  planned → in_progress → completed | cancelled
```

Transitions enforced in `packages/domain/src/care.ts`; service maps `*_TRANSITION` DomainErrors to `invalid_state`.

## Explicit non-goals (Phase 6)

- Timeline projection / event feed (Phase 7)
- Handoff closed loop, messaging, referrals (Phase 8)
- AI draft staging, contextual summaries (Phases 9–10)
- FHIR / ABDM / public directory / wearables / billing / scheduling
- HTTP route layer (service layer only, by design)

## Tests

- Domain: `packages/domain/src/observation.test.ts`, `document.test.ts`, `assessment.test.ts`, `care.test.ts`
- Integration: `apps/api/src/clinical/{clinical,private-notes,documents,clinical-rls}.integration.test.ts`
- RLS baseline: `packages/database/src/rls.test.ts` (Phase 2, must stay green)
