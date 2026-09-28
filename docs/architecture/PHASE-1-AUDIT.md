# Phase 1 Audit — Pure Domain Kernel

**Date:** 2026-09-22  
**Contract:** `docs/architecture/CONTRACT-v0.2.md` (**FROZEN**)  
**Scope:** Phase 1 only — pure domain; no infrastructure.  
**Overall result:** **PASS**

---

## 1. Domain concepts implemented

| Area              | Concepts                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity / actors | `Person`, `Professional`, `ProfessionalRole`, `Organization`, `OrganizationMembership`, `CareTeam`, `CareTeamMembership`, `Actor` (human professional / human person / machine) |
| Access            | `AccessGrant`, `AccessGrantStatus`, `AccessPurpose`, `AccessCategory`, `RelationshipClass`, `AccessDecision`, `evaluateCompiledGrant`, revoke/expire grant                      |
| Consent           | `Consent`, `ConsentRevision`, `ConsentScope`, `ConsentStatus`, issue / revoke / narrow, `evaluateConsentCoverage`                                                               |
| Assessment        | `Assessment`, `AssessmentStatus` (`draft` \| `signed` \| `amended`), content, version chain                                                                                     |
| Goals             | `Goal`, `GoalStatus`, `GoalTarget`                                                                                                                                              |
| Care plan         | `CarePlan`, `CarePlanStatus`                                                                                                                                                    |
| Interventions     | `Intervention`, `InterventionStatus`                                                                                                                                            |
| Outcomes          | `Outcome`, `OutcomeStatus`                                                                                                                                                      |
| Handoff           | `Handoff`, `HandoffStatus`, `HandoffManifest`, send/ack/close/cancel                                                                                                            |
| Invitation        | `Invitation`, `InvitationStatus`, `InvitationFlow`, accept/reject/revoke/expire                                                                                                 |
| Private notes     | `PrivateProfessionalNote`, `PromotedNoteCopy`, author-only ops, explicit promotion                                                                                              |
| Timeline          | `TimelineEventKind` tags + `TimelineEventRef` (no projection)                                                                                                                   |
| Errors            | `DomainError` + typed codes                                                                                                                                                     |
| IDs               | Opaque branded IDs (18 factories)                                                                                                                                               |

Docs: `docs/architecture/DOMAIN-KERNEL.md`.

---

## 2. State machines implemented

| Machine                 | Transitions enforced                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| Consent                 | issue → active; explicit revoke (terminal); explicit narrow (strictly smaller non-empty scope, active only) |
| Assessment              | draft → edit\* → sign (human only) → signed → amend → predecessor amended + successor draft                 |
| Goal                    | proposed → active\|abandoned; active → achieved\|abandoned; terminals locked                                |
| CarePlan                | draft → active\|cancelled; active → completed\|cancelled; terminals locked                                  |
| Intervention            | planned → in_progress\|cancelled; in_progress → completed\|cancelled; terminals locked                      |
| Handoff                 | draft → sent\|cancelled; sent → acknowledged\|cancelled; acknowledged → closed; manifest locked after send  |
| Invitation              | pending → accepted\|rejected\|revoked\|expired; all terminal after                                          |
| PrivateProfessionalNote | active → voided (author); active → promote (copy); voided terminal                                          |

Every transition has valid + invalid tests (table-driven where practical).

---

## 3. Executable invariants

| #   | Invariant                                   | Where tested                                                       |
| --- | ------------------------------------------- | ------------------------------------------------------------------ |
| 1   | Invalid state transitions fail              | consent, assessment, care, handoff, invitation, private-note tests |
| 2   | Signed assessments not silently edited      | `assessment.test.ts`                                               |
| 3   | Amendments preserve predecessor/version     | `assessment.test.ts`                                               |
| 4   | AI cannot sign                              | `MACHINE_ACTOR_FORBIDDEN` test                                     |
| 5   | Expired invitation cannot be accepted       | `EXPIRED_INVITATION` test                                          |
| 6   | Consumed invitation cannot be replayed      | `REPLAY_ATTEMPT` test                                              |
| 7   | Private notes not in handoff manifests      | `handoff.test.ts`                                                  |
| 8   | Private notes not shareable by default      | `isShareableByDefault` → false                                     |
| 9   | Promotion explicit; original unchanged      | `private-note.test.ts`                                             |
| 10  | No impossible terminal re-entry             | terminal-state tests across machines                               |
| 11  | Unknown access category/purpose fail closed | `UNKNOWN_ACCESS_*` tests                                           |
| 12  | Consent transitions explicit                | revoke/narrow only via commands                                    |
| 13  | Consent revisions immutable (append-only)   | historical revision test                                           |
| 14  | Handoff no illegal backwards transitions    | handoff lifecycle tests                                            |

---

## 4. Intentionally outside the domain layer

- Persistence, SQL, migrations, RLS
- Sessions, tokens, passwords, OAuth
- Full authorization PEP pipeline (`packages/permissions`, Phase 5)
- Timeline projection, queries, pagination
- Messaging/email/WhatsApp for handoffs
- Invite token hashing
- Cryptographic signing
- AI providers, AIDraft runtime, Context Broker
- UI, API routes, HTTP
- Notifications, exports, retention jobs

---

## 5. Dependencies of `packages/domain`

**Runtime dependencies:** none (`dependencies: {}`).  
**Dev-only:** typescript, vitest, eslint, @types/node (build/test tooling).  
**Forbidden imports verified:** no `node:`, `pg`, AI SDKs, `process.env`, framework imports in domain sources.

---

## 6. Architecture violations

**None.**

- dependency-cruiser: PASS (44 modules, 98 deps, 0 violations; `domain-purity` green).
- Contract package boundaries unchanged.
- No ADR amendments.
- No Phase 2+ features introduced (no SQL, no migrations, no HTTP server, no auth runtime).

---

## 7. Quality gates

| Gate             | Command                             | Result                        |
| ---------------- | ----------------------------------- | ----------------------------- |
| Format           | `pnpm format:check`                 | PASS                          |
| Lint             | `pnpm lint`                         | PASS                          |
| Typecheck        | `pnpm typecheck` + `typecheck:root` | PASS                          |
| Tests            | `pnpm test`                         | **PASS — 108/108** (19 files) |
| Boundaries       | `pnpm boundaries`                   | PASS                          |
| Build            | `pnpm build`                        | PASS                          |
| Dependency audit | `pnpm deps:audit`                   | PASS (0 vulnerabilities)      |
| Canonical        | `pnpm verify`                       | **PASS**                      |

No `any`, no `@ts-ignore`, no `eslint-disable`, no `continue-on-error`.

---

## 8. Unresolved architectural questions

1. **UUIDv7 concrete generation** — domain IDs remain opaque strings; concrete ID minting strategy deferred to Phase 2 persistence (compatible with architecture; not a contradiction).
2. **Partial revocation UX shape** — implemented as `narrowConsentScope` + full `revokeConsent`; product may refine presentation in Phase 5 without changing revision immutability.
3. **Outcome lifecycle** — modeled as single `recorded` state per contract minimalism; richer outcome states deferred until product requires them (ADR change control if expanded).
4. **Git repository** — still not initialized (Phase 0 F-1); not a domain issue but blocks CI-on-remote until fixed.

None of these require a contract/ADR change to proceed to Phase 2.

---

## 9. Is Phase 2 authorized?

**NO — not yet.**

Phase 2 (PostgreSQL schema + RLS + persistence + outbox) requires **separate explicit authorization** after this audit.

---

## Scorecard

```text
Domain concepts               PASS
State machines                PASS
Executable invariants         PASS (14/14)
Outside-domain boundary       PASS
Zero runtime deps             PASS
Architecture violations       NONE
Quality gates                 PASS (108/108 tests)
Audit                         PASS
Architecture Drift            NONE
Phase 2                       NOT STARTED
```
