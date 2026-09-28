# Authorization Model — Phase 5

**Normative references:** ADR-0007 (layered PEP), ADR-0008 (RLS second gate), CONTRACT-v0.2 access formula, SECURITY-INVARIANTS I-1…I-4, I-9, I-19.

## Two gates (both must allow)

```text
Request → Application PEP (packages/permissions + apps/api/src/authorization)
            │ ALLOW
            ▼
         PostgreSQL RLS (authz.can_read_health + table policies)
            │ ALLOW
            ▼
         Health rows returned
```

- **App PEP** is the semantic source: stable deny taxonomy, audit decision, AccessGrant basis.
- **RLS** is independent defense-in-depth: if app bugs omit a check, DB still denies.
- App ALLOW + DB DENY ⇒ DENY (never bypass RLS; never treat app allow as sufficient).

## Layered pipeline (ADR-0007)

1. **Authentication** — Phase 3 session → `AuthorizationActor` (person and/or professional id).
2. **RBAC** — principal type allows the action (person self vs professional).
3. **Relationship** — active `person_professional_relationship` and/or active `care_team_memberships`.
4. **Consent + AccessGrant** — active consent revision covering category × purpose × grantee × time; compiled grant active.
5. **ABAC/context** — AI purpose binding (I-18), private-note author-only (I-4), data class.
6. **Audit** — allow/deny written to `audit_logs`; allows also to `person_access_logs`.

**Organization membership is never a predicate for health ALLOW (I-3).**

## Effective access formula

```text
RBAC(role allows)
  ∧ active CareTeamMembership
  ∧ active ConsentRevision (category, purpose, grantee, time)
  ∧ ABAC/context
  ∧ purpose declared on the request
```

Membership without consent ⇒ zero health reads. Consent without membership ⇒ deny.

## PEP entry points

| API                             | Package / module                          | Role                                      |
| ------------------------------- | ----------------------------------------- | ----------------------------------------- |
| `evaluateAuthorization`         | `@health-os/permissions`                  | Pure decision over `AuthorizationContext` |
| `evaluateAuthorizationRequest`  | `@health-os/permissions`                  | Fail-closed unknown payloads              |
| `authorizeHealthAccess`         | `apps/api/src/authorization/authorize.ts` | Loads facts from DB, evaluates, audits    |
| `readHealthRowsAsPrincipal`     | same                                      | SQL under principal + purpose after ALLOW |
| `evaluateHealthAccess` (legacy) | `@health-os/permissions`                  | Phase 1–4 regression API                  |

Context is **server-derived only** — clients never construct `AuthorizationContext`.

## Deny reasons (stable, SCREAMING_SNAKE)

`NO_AUTHENTICATED_PRINCIPAL`, `NO_RELATIONSHIP`, `MEMBERSHIP_ENDED`, `NO_ACTIVE_CONSENT`, `CONSENT_REVOKED`, `PURPOSE_REQUIRED`, `PURPOSE_NOT_CONSENTED`, `CATEGORY_NOT_CONSENTED`, `NO_EFFECTIVE_GRANT`, `GRANT_EXPIRED`, `GRANT_REVOKED`, `PERSON_MISMATCH`, `CROSS_ORGANIZATION`, `PRIVATE_NOTE`, `AI_CONTEXT_NOT_CONSENTED`, `ROLE_NOT_PERMITTED`, `UNKNOWN_CATEGORY`, `UNKNOWN_PURPOSE`, `GRANT_PERSON_MISMATCH`, `GRANT_GRANTEE_MISMATCH`, `GRANT_CATEGORY_MISMATCH`, `GRANT_PURPOSE_MISMATCH`.

Fail-closed: null/missing principal, empty purpose, unknown category/purpose all deny.

## Actions

`read`, `create`, `update`, `amend`, `share`, `handoff`, `ai_context`.

## Revocation propagation (I-9)

- Mechanism: synchronous `UPDATE access_grants … status='revoked'` in the same service transaction; no cache layer.
- SLA: deny on next request, measured ≤ 5000 ms (`REVOCATION_SLA_MS`).
- Paths: person consent revoke; care-team membership end; care-team close (inline SQL in collaboration service).

## Person self path

Person principal with matching `personId` may read own non-private health categories without an AccessGrant. Cross-person id ⇒ `PERSON_MISMATCH`. Private notes always `PRIVATE_NOTE` for persons.

## Module boundaries

- `packages/permissions` — pure policy; no database/web/framework imports.
- `apps/api/src/consent` — consent/access-request mutations (person grantor).
- `apps/api/src/authorization` — PEP orchestration, compiler persistence, revocation, summary; re-exports consent service.
- `packages/domain` — pure compiler and consent state machines.
