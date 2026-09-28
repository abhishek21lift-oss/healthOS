# Health Collaboration OS — Architecture & Domain Contract — v0.2

**Status:** FROZEN  
**Supersedes:** Architecture Discovery Document v0.1  
**Change control:** See `docs/adr/README.md`. Implementation convenience is not sufficient to amend this contract.

---

## Locked product decisions

| ID  | Decision                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | India-first jurisdiction; architecture portable for later expansion; no legal/regulatory compliance claims without expert validation.   |
| D2  | Hybrid B2B + B2C; person is always the health-data authority; organizations never own person health data.                               |
| D3  | Self-signup **and** professional invitation; duplicate prevention and identity claim rules required.                                    |
| D4  | Private professional notes: separate security classification; author-only; not person-visible by default; AI only under explicit scope. |
| D5  | AI MVP = Contextual Summary + Professional Handoff Draft + Documentation AI, under hard safety red lines.                               |
| D6  | MVP accounts are 18+; invite/code-based discovery only; no public directory.                                                            |

---

## Core product principles (normative)

1. Person-centric, not organization-centric.
2. Longitudinal health and performance timeline.
3. Granular consent and permission system.
4. Role-based + relationship + attribute/context-based authorization.
5. Strong auditability.
6. Data provenance for important health information.
7. Structured health events instead of unstructured notes only.
8. Professional-to-professional handoffs with closed loop.
9. Shared care plans with role-specific visibility.
10. AI-native but human-controlled.
11. AI must not silently diagnose, prescribe, attest, sign, or make autonomous clinical decisions.
12. Important AI outputs must be traceable to source context.
13. Minimum-necessary data exposure.
14. Security and privacy are architectural foundations.
15. Extensibility without premature microservices.

---

## Architecture summary (normative)

- **Shape:** modular monolith (`apps/api`) + separate worker (`apps/worker`) + web (`apps/web`) in one monorepo.
- **Language:** strict TypeScript throughout.
- **Database:** single PostgreSQL; RLS defense-in-depth; separate migrator role later (Phase 2).
- **Async:** transactional outbox → worker consumers; no Redis/Kafka required for MVP.
- **Writes:** typed domain aggregates; timeline is a derived projection.
- **AuthZ:** RBAC ∧ care relationship ∧ consent ∧ ABAC/context ∧ minimum-necessary; central policy enforcement point; compiled AccessGrant.
- **AI path:** Task Registry → Context Broker → AI Provider → Validator → Human Gate. Models never access the database, never receive unrestricted tools/SQL, never see context outside an approved `AIContext`.
- **Private notes:** separate schema/classification (`PROFESSIONAL_PRIVATE`); not UI-hidden sharing.

### Package boundaries (normative)

| Package/App            | May depend on                                                      | Must not depend on                                           |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| `packages/domain`      | (nothing external I/O)                                             | database, HTTP, fs, env, frameworks, AI SDKs                 |
| `packages/permissions` | domain                                                             | web, API framework, database implementation, AI provider     |
| `packages/validation`  | domain                                                             | framework-specific runtimes beyond schema lib                |
| `packages/database`    | domain, validation                                                 | leaking persistence into domain                              |
| `packages/auth`        | domain, validation                                                 | becoming the authorization engine                            |
| `packages/ui`          | (presentation only)                                                | authorization decisions, database, clinical policy, AI logic |
| `apps/api`             | domain, database, auth, permissions, validation                    | —                                                            |
| `apps/worker`          | domain, database, validation, permissions, future AI/context infra | —                                                            |
| `apps/web`             | API contracts, validation, ui                                      | PostgreSQL / database package                                |

Forbidden relationships (enforced in CI, not documentation alone):

```text
web → database
domain → database
domain → framework
domain → AI
ui → permissions engine (authorization decisions)
ai broker (future package) → direct database bypass of permissions
```

---

## Locked domain model (normative overview)

Entities (keep list; additions require ADR):

`Identity`, `Person`, `Professional`, `ProfessionalRole`, `Organization`, `CareTeam`, `CareTeamMembership`, `Consent`, `ConsentRevision`, `AccessGrant`, `AccessRequest`, `Invitation`, `Observation`, `Assessment`, `AssessmentItem`, `Goal`, `CarePlan`, `Intervention`, `Outcome`, `Document`, `PrivateProfessionalNote`, `Referral`, `Handoff`, `HandoffAcknowledgement`, `Task`, `TimelineEntry`, `AIContext`, `AIContextSource`, `AIInteraction`, `AIDraft`, `AuditLog`, `DomainEventOutbox`, `Notification`, `AccessLogEntry`.

### Critical distinctions

```text
ProfessionalRole  = who I am professionally, where employed (no health power)
Organization link = which org I work for (ops tenancy, no health power)
CareTeamMembership = am I on this person's team (necessary, not sufficient)
Consent(+Revision) = what the person allows me to do, purposes, until when
AccessGrant        = compiled allow/deny with basis chain (system, audited)
AccessRequest      = proposal that can become consent (no power while pending)
```

**Effective access formula:**

```text
RBAC(role allows action)
  ∧ active CareTeamMembership
  ∧ active ConsentRevision covering (category, purpose, grantee, time)
  ∧ ABAC/context
  ∧ purpose declared on the request
```

Membership without consent ⇒ zero health reads. Consent without membership ⇒ deny.

### Private professional notes (normative MVP rules)

- Author-only create/read/update/void.
- Invisible to organization administrators (content and counts).
- Excluded from shared timeline.
- Excluded from handoff manifests.
- Excluded from normal AI context (summary and handoff tasks prohibit the class).
- Documentation AI may include author-selected notes only under explicit scope flags.
- Promotion creates a shared copy/event with new provenance; the original remains private.
- Never implement solely as hidden UI.

### AI red lines (normative)

AI must never:

- diagnose, prescribe, sign clinical records, or attest clinical facts
- send health conclusions autonomously to persons
- directly mutate authoritative health records
- access the database directly or execute arbitrary SQL/tools
- bypass authorization
- receive context outside an approved AIContext

AI may only operate through:

```text
Task Registry → Context Broker → AI Provider → Validator → Human Gate
```

Output classes: `informational_draft` | `record_bound` | `outbound`.  
Record-bound and outbound outputs require explicit human approval. There is no autonomous AI write into signed records.

### Data classes (normative)

`PUBLIC` · `INTERNAL` · `PERSON_PRIVATE` · `SHARED_HEALTH` · `PROFESSIONAL_PRIVATE` · `HIGH_SENSITIVITY` · `SYSTEM_SECURITY`

---

## Security invariants (summary — full list in `docs/security/SECURITY-INVARIANTS.md`)

1. No health read without principal ∧ membership ∧ AccessGrant ∧ purpose.
2. Person is sole consent grantor/revoker.
3. Org role never appears in health-read policy predicates.
4. Private notes readable only by author.
5. Private notes never in shared timeline or handoff manifests (MVP).
6. AI only with valid AIContext; no DB credentials for models.
7. AI enters signed records only via human SIGN/approve.
8. No autonomous AI messages with health conclusions to persons.
9. Revoke ⇒ deny on next request (staleness ≤ 5s).
10. Audit immutable to app role; health access always audited.
11. Cross-person probes return 404.
12. Notifications never contain SHARED/HIGH bodies.
13. Tokens hashed; never logged.
14. Break-glass: reason + TTL + notify + rate cap; never for AI tasks.
15. Person export excludes `PROFESSIONAL_PRIVATE` by default.
16. Logs contain no SHARED/HIGH/PRIVATE payloads.
17. Invite consumption never forks an existing person on verified contact match.
18. AI requires purpose `ai_assistance` and category `ai_context`.
19. Deny by default for unknown task/category/purpose.
20. One open care team per person.

---

## MVP scope freeze (from v0.2 §15)

**MUST / SHOULD / LATER / NEVER** lists are frozen as approved in Architecture & Domain Contract v0.2.  
Phase 0 implements **none** of the health features.

**Phase 0 may not create:** database schema, migrations, RLS, auth implementation, authorization logic, consent logic, clinical entities, timeline, AI calls, UI features, API health endpoints, integrations, secrets, LLM providers, document storage, Redis, Kafka, microservices.

---

## Compliance posture (normative)

Architecture is designed with India-first privacy/security principles and DPDP-shaped **seams**.  
This repository does **not** claim DPDP compliance, HIPAA compliance, medical-device compliance, or regulatory approval. Compliance remains a separate legal/product validation track before production.

---

## Phase status

| Phase                                               | Status                                                                                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture freeze + Phase 0 repository foundation | **PASS** — see `PHASE-0-AUDIT.md`                                                                                                         |
| Phase 1 pure domain kernel                          | **PASS** — see `DOMAIN-KERNEL.md`, `PHASE-1-AUDIT.md`                                                                                     |
| Phase 2 database + PostgreSQL + RLS                 | **PASS** — see `DATABASE-ARCHITECTURE.md`, `PHASE-2-AUDIT.md`                                                                             |
| Phase 3 identity/auth/sessions/invite tokens        | **PASS** — see `PHASE-3-AUDIT.md`, `AUTHENTICATION-ARCHITECTURE.md`, `IDENTITY-SECURITY.md`                                               |
| Phase 4 collaboration graph + membership lifecycle  | **PASS** — see `PHASE-4-AUDIT.md`, `COLLABORATION-GRAPH.md`, `COLLABORATION-SECURITY.md`                                                  |
| Phase 5 consent + policy + AccessGrant compiler     | **PASS** — see `PHASE-5-AUDIT.md`, `CONSENT-POLICY.md`, `AUTHORIZATION-MODEL.md`, `ACCESSGRANT-COMPILER.md`                               |
| Phase 6 clinical + private notes + documents        | **PASS** — see `PHASE-6-AUDIT.md`, `CLINICAL-CORE.md`, `PRIVATE-NOTES.md`, `DOCUMENT-SECURITY.md`, `CLINICAL-DATA-SECURITY.md`            |
| Phase 7 timeline projection                         | **PASS** — see `PHASE-7-AUDIT.md`, `TIMELINE-ARCHITECTURE.md`, `TIMELINE-SECURITY.md`, `TIMELINE-PROJECTION.md`, `TIMELINE-PAGINATION.md` |
| Phase 8+ (handoff, AI, …)                           | Not authorized until explicit approval after Phase 7 audit                                                                                |
