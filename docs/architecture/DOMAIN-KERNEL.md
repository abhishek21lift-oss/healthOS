# Domain Kernel (Phase 1)

Authoritative package: `packages/domain`  
Contract: `docs/architecture/CONTRACT-v0.2.md` (**FROZEN**)  
Depends on: **nothing** (no database, HTTP, fs, env, frameworks, AI SDKs, Node builtins).

---

## Modules

| Module            | Responsibility                                                                      |
| ----------------- | ----------------------------------------------------------------------------------- |
| `errors.ts`       | `DomainError` + typed codes; no free-form failure strings                           |
| `ids.ts`          | Opaque branded IDs (non-empty string validation only)                               |
| `primitives.ts`   | Data classes, access categories/purposes, actors, time windows, fail-closed parsers |
| `actors.ts`       | Person, Professional, ProfessionalRole, Organization, memberships, CareTeam         |
| `access.ts`       | AccessGrant facts + compiled-grant evaluation (not the full PEP)                    |
| `consent.ts`      | Consent aggregate, append-only revisions, revoke/narrow, coverage                   |
| `assessment.ts`   | Assessment draft → signed → amend; AI cannot sign                                   |
| `care.ts`         | Goal, CarePlan, Intervention, Outcome lifecycles                                    |
| `handoff.ts`      | Handoff draft → sent → ack → close; manifest lock; private-note exclusion           |
| `invitation.ts`   | Single-use short-TTL invitation lifecycle                                           |
| `private-note.ts` | PrivateProfessionalNote + explicit promotion copy                                   |
| `timeline.ts`     | Timeline event **kind tags only** (no projection)                                   |
| `index.ts`        | Barrel + `DOMAIN_CONTRACT_VERSION`                                                  |

---

## Aggregate boundaries

| Aggregate                                | Root identity               | Child / history                                       |
| ---------------------------------------- | --------------------------- | ----------------------------------------------------- |
| Consent                                  | `ConsentId`                 | append-only `ConsentRevision[]`                       |
| Assessment                               | `AssessmentId`              | amendment successor links (`predecessorAssessmentId`) |
| CareTeam                                 | `CareTeamId`                | memberships                                           |
| Handoff                                  | `HandoffId`                 | locked manifest after send                            |
| Invitation                               | `InvitationId`              | terminal after accept/reject/revoke/expire            |
| PrivateProfessionalNote                  | `PrivateProfessionalNoteId` | promotion produces a separate shared copy             |
| Goal / CarePlan / Intervention / Outcome | own IDs                     | status transitions only                               |

Health data roots remain `personId` (ADR-0001). Organizations never own health data.

---

## Value objects / IDs

Opaque brands: `PersonId`, `ProfessionalId`, `OrganizationId`, `CareTeamId`, `CareTeamMembershipId`, `OrganizationMembershipId`, `ConsentId`, `ConsentRevisionId`, `AccessGrantId`, `AssessmentId`, `GoalId`, `CarePlanId`, `InterventionId`, `OutcomeId`, `HandoffId`, `InvitationId`, `PrivateProfessionalNoteId`, `ProfessionalRoleId`.

No database type coupling. Factories reject empty/whitespace strings.

---

## State machines

### Consent

```text
(issued, revision 1 active)
  → revokeConsent (appends revoked revision; status=revoked)   [terminal for further ops]
  → narrowConsentScope (appends smaller active revision)       [active only, strictly smaller non-empty]
```

Only the person grantor may revoke/narrow. Revisions are never mutated in place.

### Assessment

```text
draft → (edit)* → sign(human professional only) → signed
signed → amend → predecessor=amended + successor=draft(version+1)
```

Machine/AI actors throw `MACHINE_ACTOR_FORBIDDEN`. Signed content immutable.

### Goal

```text
proposed → active | abandoned
active → achieved | abandoned
achieved | abandoned → (terminal)
```

### CarePlan

```text
draft → active | cancelled
active → completed | cancelled
completed | cancelled → (terminal)
```

### Intervention

```text
planned → in_progress | cancelled
in_progress → completed | cancelled
completed | cancelled → (terminal)
```

### Handoff

```text
draft → sent | cancelled
sent → acknowledged | cancelled
acknowledged → closed
closed | cancelled → (terminal)
```

Manifest locked after send. Empty manifest cannot send. Private note IDs / `ppn:` refs rejected.

### Invitation

```text
pending → accepted | rejected | revoked | expired
* → (terminal)
```

Accept fails on `EXPIRED_INVITATION` or `REPLAY_ATTEMPT`.

### PrivateProfessionalNote

```text
active → voided (author only)
active → promote (copy out; original unchanged)
voided → (terminal)
```

---

## Executable invariants (tested)

1. Invalid state transitions fail (typed `INVALID_*_TRANSITION`).
2. Signed assessments cannot be silently edited.
3. Amendments preserve predecessor/successor version chain.
4. AI/machine cannot sign assessments.
5. Expired invitations cannot be accepted.
6. Consumed invitations cannot be replayed.
7. Private notes cannot enter handoff manifests.
8. Private notes are not shareable by default.
9. Promotion is explicit and does not mutate the original.
10. Domain objects cannot enter impossible terminal states.
11. Unknown access categories/purposes fail closed (`UNKNOWN_ACCESS_*`).
12. Consent transitions are explicit (revoke/narrow only via commands).
13. Historical consent revisions remain immutable (append-only).
14. Handoff cannot transition backwards illegally.

---

## Domain errors

`DomainError` with `code` ∈  
`INVALID_DOMAIN_VALUE`, `INVALID_STATE_TRANSITION`, `INVALID_CONSENT_TRANSITION`, `INVALID_ASSESSMENT_TRANSITION`, `INVALID_HANDOFF_TRANSITION`, `INVALID_INVITATION_TRANSITION`, `INVALID_GOAL_TRANSITION`, `INVALID_CARE_PLAN_TRANSITION`, `INVALID_INTERVENTION_TRANSITION`, `INVALID_OUTCOME_TRANSITION`, `INVALID_PRIVATE_NOTE_TRANSITION`, `EXPIRED_INVITATION`, `REPLAY_ATTEMPT`, `PRIVATE_NOTE_CANNOT_BE_SHARED`, `INVALID_PROMOTION`, `MACHINE_ACTOR_FORBIDDEN`, `UNKNOWN_ACCESS_CATEGORY`, `UNKNOWN_ACCESS_PURPOSE`, `HANDOFF_MANIFEST_LOCKED`, `ASSESSMENT_CONTENT_IMMUTABLE`, `CONSENT_REVISION_IMMUTABLE`.

---

## Forbidden dependencies

Database · Prisma · Drizzle · Supabase · Redis · Fastify · Express · Next · React · Node APIs · fs · env · HTTP clients · AI SDKs · queues · storage · auth libraries · authz middleware.

Enforced by: dependency-cruiser `domain-purity`, ESLint restricted imports, architecture freeze tests.

---

## Authorization boundary

Phase 1 supplies **facts and invariants only**:

- AccessGrant shape + fail-closed compiled evaluation
- Consent coverage query
- Relationship class tags
- Membership active flags

It does **not** implement the full pipeline  
`identity + membership + relationship + consent + purpose + policy + AccessGrant`  
(that is `packages/permissions`, Phase 5). Org role is never a health-read predicate.

---

## Belongs to later layers

| Concern                                        | Phase |
| ---------------------------------------------- | ----- |
| Persistence, SQL, migrations, RLS              | 2     |
| Sessions, tokens, password/OIDC                | 3     |
| Invite token hashing / transport               | 4     |
| Central PEP / AccessGrant compile runtime      | 5     |
| Clinical storage + private-note isolation      | 6     |
| Timeline projection / queries                  | 7     |
| Handoff messaging / notifications              | 8     |
| AI broker, AIDraft staging, human gate runtime | 9–10  |

---

## API style

Constructories + explicit transition functions (`signAssessment`, `revokeConsent`, `sendHandoff`, `acceptInvitation`, `promotePrivateNote`, …). Entities are immutable; transitions return new instances. No `entity.status = …` public mutation.
