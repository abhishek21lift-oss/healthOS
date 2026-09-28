# Collaboration Graph — Phase 4

**Normative references:** CONTRACT-v0.2 (I-1, I-3, I-9, I-11, I-17, I-19, I-20), ADR-0001, ADR-0004, ADR-0007, ADR-0008, SECURITY-INVARIANTS, RLS-MODEL.

## Scope

Phase 4 implements the **collaboration graph only**: organizations, memberships, care teams, person↔professional relationships, and invitation claim workflows (Flow A / Flow B).

**Not in Phase 4:** consent UI/workflows, AccessGrant compiler, health authorization engine, clinical APIs, AI, timeline, documents, handoff, messaging, public directory, billing, scheduling, OAuth/SSO, policy editor.

## Graph entities

```text
Person ──< person_professional_relationships >── Professional
   │                                                │
   │ care_teams / care_team_memberships             │ organization_memberships
   ▼                                                ▼
 (one open care team)                         Organization
                                                (status: active|inactive)
```

| Entity                              | Key constraints                                                                                                                 | Notes                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `organizations`                     | `status ∈ {active,inactive}`                                                                                                    | Operational tenancy only — never health ACL (I-3)  |
| `organization_memberships`          | `role ∈ {owner,admin,manager,staff}`; `status ∈ {invited,active,ended}`; partial unique on `(org, professional)` while `invited | active`                                            | Exactly four org roles; ended → re-invite allowed |
| `organization_membership_history`   | append-only; `prevent_mutation()`                                                                                               | invited → activated → role_changed → ended         |
| `care_teams`                        | one open per person (`uq_care_teams_one_open_per_person`)                                                                       | I-20                                               |
| `care_team_memberships`             | `active` unique per `(team, professional)`                                                                                      | Relationship fact, not health access               |
| `person_professional_relationships` | one active per `(person, professional)`                                                                                         | Created on care-team add or invitation claim       |
| `invitations`                       | single-use; hashed token; TTL; recipient binding                                                                                | Flow A `professional_first`, Flow B `person_first` |
| `collaboration_security_events`     | append-only; no `token`/`password`/`session_token`/`health` in metadata                                                         | Collaboration audit only                           |

## Membership lifecycle

```text
invited ──activate (self or admin)──► active ──end (self or admin)──► ended
   │                                      │
   └──end─────────────────────────────────┘

ended → invite again allowed (partial unique index)
ended → activate denied (invalid_state)
```

Roles: `owner` assigns `owner`; owner/admin manage roles and membership end; staff cannot change roles (forbidden).

## Care team + relationship

```text
createCareTeam (person self) → open
addCareTeamMember (person self) → care_team_memberships.active
                                 → person_professional_relationships.active (upsert)
removeCareTeamMember / closeCareTeam → membership ended
                                     → relationship ended when no other active pair membership
```

Client-supplied `personId` that mismatches the session principal → `forbidden` (I-11 pattern for collaboration ops).

## Invitation flows (ADR-0004)

| Flow | DB `flow`            | Direction             | Claimant     | On success                                                       |
| ---- | -------------------- | --------------------- | ------------ | ---------------------------------------------------------------- |
| A    | `professional_first` | professional → person | person       | accept + care team (create if none) + membership + relationship  |
| B    | `person_first`       | person → professional | professional | accept + care team membership if open team exists + relationship |

Claim steps (single transaction, `SELECT … FOR UPDATE`):

1. Load invitation by `token_hash` `FOR UPDATE`
2. Recipient binding (normalized email) → else `wrong_recipient`
3. Status pending + not consumed → else `invalid_token` (replay)
4. TTL → else mark expired + `expired_token`
5. Domain accept transition
6. CAS consume: `status='pending' AND consumed_at IS NULL`
7. Care team + membership + relationship upsert
8. Audit event — no health grant of any kind

Concurrent claim: row lock serializes; exactly one CAS succeeds.

## Actor resolution

`requireCollaborationActor(authDeps, sessionToken)` → Phase 3 `resolveSession` → `CollaborationActor`.

- Server derives `personId` / `professionalId` from the session only.
- Never trust client-supplied principal IDs for authorization decisions.

## Service layer

| Module                                        | Responsibility                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `apps/api/src/collaboration/organizations.ts` | org create/status, membership invite/activate/end/role, list my memberships |
| `apps/api/src/collaboration/care-teams.ts`    | care team create/close, add/remove member, relationships                    |
| `apps/api/src/collaboration/invitations.ts`   | Flow A/B issue, claim, revoke, reject                                       |
| `apps/api/src/collaboration/session.ts`       | session → actor                                                             |
| `apps/api/src/collaboration/types.ts`         | errors, events, membership load helpers                                     |

Domain state machines live in `packages/domain/src/collaboration.ts`. `DomainError` is mapped to `CollaborationError` at the service boundary (`toCollaborationError`).

## RLS summary (Phase 4)

| Table                               | SELECT sketch                                                     | Notes                                                 |
| ----------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| `organizations`                     | system or active member                                           | no public directory (D6)                              |
| `organization_memberships`          | system or self                                                    | non-recursive (0014); admin roster via system context |
| `professionals`                     | system, self, active org peer, active relationship/care-team peer | invite-only discovery                                 |
| `invitations`                       | system, inviter, or claimer                                       | not any principal with context                        |
| `care_teams`                        | system, person self, active member professional                   | 0014 adds system for RETURNING                        |
| `care_team_memberships`             | system, person self, row professional                             | non-recursive                                         |
| `person_professional_relationships` | system, self person, row professional                             |                                                       |
| `organization_membership_history`   | system, subject, or org owner/admin                               |                                                       |
| `collaboration_security_events`     | system, subject, actor, or org owner/admin                        | append-only                                           |

Mutations run under `runInSystemContext` after app-layer authz checks (`CollaborationError`). Reads use principal context where isolation is proven.

## Migrations

- `0013_collaboration_phase4.sql` — schema, events, history, initial Phase 4 RLS
- `0014_phase4_rls_fix.sql` — non-recursive org membership policies, system care-team visibility, `clock_timestamp()` history ordering

## Tests

`apps/api/src/collaboration/collaboration.integration.test.ts` (database project):

- Org create / status deny / membership lifecycle + history order
- Role boundaries (staff forbidden), cross-org isolation
- Care team I-20, impersonation deny, relationship end
- Flow A claim (wrong recipient, replay, expired, revoked, unknown, concurrent)
- Flow B claim (wrong professional, person cannot claim, revoke, recipient reject)
- I-3 org role → 0 health rows; I-1 care team without grant → 0 health rows
- RLS isolation (professionals, org memberships, invitations, care teams)
- I-17 claim does not fork person

## Forbidden boundaries (still enforced)

`pnpm boundaries` — no health authorization from org membership; collaboration package does not import consent/AccessGrant evaluation; domain remains pure.
