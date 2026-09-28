# Collaboration Security — Phase 4

**Normative references:** SECURITY-INVARIANTS (I-1, I-3, I-9, I-11, I-13, I-17, I-19, I-20), ADR-0004, ADR-0007, ADR-0008, RLS-MODEL, CONTRACT D6.

## Primary invariant: I-3

**Organization membership (any role) never authorizes health data access.**

Enforcement layers:

1. **Schema** — `organization_memberships` is operational tenancy only (ADR-0001 comment on table).
2. **RLS** — `authz.can_read_health` never references `organization_memberships` or `organizations`.
3. **App** — collaboration service returns org/care-team/invitation facts only; no health read APIs in Phase 4.
4. **Tests** — org admin with active `owner`/`admin` membership reads 0 `observations` and 0 `private_professional_notes`.

Care-team membership alone is also **not** health access (I-1): without an active AccessGrant covering category+purpose, `can_read_health` is false. Phase 4 proves this; grant compilation remains Phase 5.

## Threats and controls

| Threat                             | Control                                                                     | Evidence                                            |
| ---------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------- |
| Cross-org membership read/manage   | App authz (`requireOrgAdmin`) + RLS self-only membership select             | tests: cross-organization forbid; RLS 0 rows        |
| Invitation token theft / replay    | SHA-256 hash at rest; single-use CAS; TTL; row lock                         | concurrent claim exactly one wins                   |
| Wrong-recipient claim              | `recipient_normalized` vs claimant account email                            | wrong_recipient tests Flow A/B                      |
| Person fork on invite (I-17)       | Claim reuses existing person for verified contact                           | person count unchanged                              |
| Public professional directory (D6) | `professionals_select` requires relationship, care team, or active org peer | person with no links → 0 professionals              |
| Org admin health scrape            | I-3 RLS + no org in health predicate                                        | I-3 tests                                           |
| Care team ≠ consent                | Membership without grant → 0 health rows                                    | I-1 test                                            |
| Client impersonation               | Actor from session only; `personId` mismatch → forbidden                    | impersonation test                                  |
| Secrets in collaboration audit     | metadata CHECKs forbid `token`, `password`, `session_token`, `health`       | migration CHECKs + `assertNoForbiddenEventMetadata` |
| Membership history rewrite         | `prevent_mutation()` trigger; no UPDATE/DELETE grant                        | append-only table                                   |
| Collaboration event rewrite        | same                                                                        | append-only table                                   |
| Recursive RLS DoS / lockup         | non-recursive org membership policies (0014)                                | migration 0014                                      |
| Session fixation / stolen cookie   | Phase 3 session controls unchanged                                          | Phase 3 audit                                       |

## Authorization model (collaboration)

```text
HTTP/session principal
        │
        ▼
requireCollaborationActor ──► CollaborationActor { personId?, professionalId? }
        │
        ▼
app-layer checks (CollaborationError: forbidden / not_found / conflict / invalid_state)
        │
        ▼
runInSystemContext (mutations) or beginRequest principal context (reads)
        │
        ▼
PostgreSQL RLS (defense in depth)
```

Org role hierarchy for collaboration ops only:

| Action                      | Allowed                                                  |
| --------------------------- | -------------------------------------------------------- |
| create organization         | professional → founder becomes `owner`                   |
| change org status           | active `owner`/`admin`                                   |
| invite member               | active `owner`/`admin`                                   |
| activate membership         | invitee self or admin                                    |
| end membership              | self or admin                                            |
| change role                 | active `owner`/`admin`; assigning `owner` requires owner |
| create/add/remove care team | person self (session personId)                           |
| end relationship            | person self or professional self                         |
| claim invitation            | recipient only                                           |
| revoke invitation           | inviter only                                             |
| reject invitation           | recipient only                                           |

## Invitation security (ADR-0004 / I-13 / I-17)

- Token generated server-side (`generateToken`); only `hashToken` (SHA-256) stored.
- Raw token returned once to issuer; never written to logs or `collaboration_security_events`.
- `contact_hint` masks local part (`ab***@domain`).
- Expiry: `expires_at = now() + ttl`; claim after expiry marks `expired` and fails closed.
- Concurrency: `FOR UPDATE` + `UPDATE … WHERE status='pending' AND consumed_at IS NULL`.
- Claim never creates AccessGrant or consent.

## RLS isolation tests (Phase 4)

| Scenario                                               | Expected     |
| ------------------------------------------------------ | ------------ |
| Person without relationship enumerates `professionals` | 0 rows       |
| Professional B reads org A memberships                 | 0 rows       |
| Professional reads others’ pending invitations         | 0 rows       |
| Person reads another person’s care teams               | 0 rows       |
| Org admin reads observations / private notes           | 0 rows (I-3) |
| Care team member without grant reads observations      | 0 rows (I-1) |

Phase 2 RLS suite (28) and Phase 3 auth suite remain green under the same database project run.

## Privilege model

| Role           | Collaboration tables                                                        |
| -------------- | --------------------------------------------------------------------------- |
| `health_app`   | SELECT/INSERT/UPDATE as granted in 0013; no UPDATE/DELETE on history/events |
| `health_owner` | table owner; FORCE RLS                                                      |
| superuser      | migrations + test fixtures only                                             |

## Out of scope (not claimed)

- Consent enforcement UI / AccessGrant compiler (Phase 5)
- Break-glass product flow (Phase 11)
- Network/TLS/secret rotation hardening (Phase 11)
- DPDP/HIPAA compliance certification
