# AccessGrant Compiler — Phase 5

**Normative references:** ADR-0006, CONTRACT-v0.2 (`AccessGrant`), SECURITY-INVARIANTS I-1, I-4, I-9.

## Purpose

`AccessGrant` is the compiled allow artifact: always recomputable from active ConsentRevision + active CareTeamMembership. It is the audit basis stamp and the fast path for RLS/PEP checks — not a source of truth independent of consent.

## Pure domain function

```text
compileAccessGrants(consentRevision, membership, grantIdFactory) → AccessGrant[]
```

Rules:

1. Revision must be `active`; otherwise `[]`.
2. Membership must be present and `active`; otherwise `[]` (consent without membership ⇒ deny).
3. Emit one grant per `(category, purpose)` in the revision scope (cartesian product).
4. **Never** emit `private_note_read` (I-4 — structural author-only class, not consent-granted).
5. Grant window copies the revision window; `membershipId` / `relationship` from membership basis.

Related pure helpers:

| Function                    | Behavior                                                 |
| --------------------------- | -------------------------------------------------------- |
| `scopeGrantCandidates`      | List `(category, purpose)` pairs for a scope             |
| `candidateKey`              | Stable `category::purpose` string for set reconciliation |
| `revokeGrantsForConsent`    | Idempotent revoke of grants tied to a consent id         |
| `reconcileGrantsToRevision` | keep / upsert / revoke sets when scope narrows           |
| `revokeAccessGrant`         | Set status revoked; seal `effectiveUntil`; idempotent    |

## Persistence (service layer)

- System principal context only (`runInSystemContext`); professionals never INSERT/UPDATE `access_grants` (RLS 0015).
- UPSERT on unique `(person_id, grantee_professional_id, category, purpose)`.
- On recompile: revoke active grants whose key is no longer in the desired set; upsert survivors.
- Audit event `grants_compiled` / `grants_revoked` in the same transaction.

## Idempotency

Re-running compile for the same revision+membership yields the same key set; UPSERT does not create duplicates. Concurrent issue paths are serialized by consent row `FOR UPDATE` where needed.

## Failure modes (fail closed)

| Condition                    | Result                       |
| ---------------------------- | ---------------------------- |
| No membership                | zero grants                  |
| Revoked revision             | zero grants                  |
| Scope contains private notes | private_note row skipped     |
| Purpose not in consent scope | grant not present → PEP deny |

## Tests

- `packages/domain/src/access-compiler.test.ts` (pure)
- Consent/authorization integration suites (persisted grants + RLS probe)
