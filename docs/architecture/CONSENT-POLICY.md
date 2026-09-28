# Consent Policy — Phase 5

**Normative references:** CONTRACT-v0.2 access formula, ADR-0006, ADR-0007, SECURITY-INVARIANTS I-1, I-2, I-9, I-19.

## Principle

Consent is the person's grant of health-data access to a specific professional for a specific **category × purpose** within a validity window. Relationship or organization membership alone never substitutes for consent.

## Entities

| Table               | Role                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `consents`          | One active consent head per `(person, grantee)` pair; status `active \| revoked`          |
| `consent_revisions` | Append-only history; scope = categories × purposes; issued by person only                 |
| `access_grants`     | Compiler artifact: one active row per `(person, grantee, category, purpose)` when allowed |
| `access_requests`   | Professional proposal; **zero health power while pending**                                |

## Person is sole grantor/revoker (I-2)

- Only a session **person** principal may issue, narrow, or revoke consent.
- Organization admins and other professionals cannot grant or revoke consent.
- Service layer rejects professional actors on consent mutations (`ConsentError.forbidden`).
- PostgreSQL write policies allow system-context mutation after app-layer person check (migration 0015).

## Lifecycle

```text
issue ──► active ──narrow──► active (smaller scope) ──► active
              │
              └──revoke──► revoked ──re-issue──► active (new revision)
```

- **Issue:** domain `issueConsent` → insert revision → compile grants (membership required) → audit, same transaction.
- **Narrow:** new revision with reduced scope; out-of-scope grants revoked; survivors re-pointed.
- **Revoke:** new revision status `revoked`; all active grants for the pair revoked in-tx; next request denies (I-9).
- **Re-issue:** only after prior full revoke; appends continued revision number.

## AccessRequest

1. Professional creates proposal with bound categories/purposes (relationship required).
2. While `pending`: no grants, no RLS unlock, PEP denies.
3. Person **accept** may materialize first consent + grants in the same transaction (scope never expands beyond the request).
4. Person **reject** / requester **withdraw**: terminal; no consent.

## Fail-closed rules

- Purpose required on every health access request (I-19).
- Unknown category or purpose ⇒ deny.
- Wildcard categories (`ALL_HEALTH_DATA`, `*`, `EVERYTHING`) are not valid `AccessCategory` values.
- `purpose=ai_assistance` requires `category=ai_context` and vice versa (I-18).
- `private_note_read` is never compiled into an ordinary AccessGrant (I-4 / ADR-0005).

## Compiler binding (ADR-0006)

`compileAccessGrants` is pure domain code: cartesian product of consent scope when membership is active; zero grants otherwise. Persistence runs under system principal; unique key `(person, grantee, category, purpose)` makes recompile idempotent.

## Evidence

- Unit: domain consent/compiler tests; permissions deny taxonomy.
- Integration: `apps/api/src/consent/consent.integration.test.ts`, `apps/api/src/authorization/authorization.integration.test.ts`.
- RLS: migration 0015 write policies + strengthened `authz.can_read_health`.
