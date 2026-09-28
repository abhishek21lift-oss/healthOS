# Architecture Decision Records

Status of **Architecture & Domain Contract v0.2**: **FROZEN**.

All ADRs in this directory are **Accepted** unless a superseding ADR says otherwise.

## Index

| ADR                                                  | Title                                          |
| ---------------------------------------------------- | ---------------------------------------------- |
| [0001](0001-person-centric-health-data-model.md)     | Person-centric health data model               |
| [0002](0002-hybrid-b2b-b2c-product-model.md)         | Hybrid B2B + B2C product model                 |
| [0003](0003-india-first-regulatory-posture.md)       | India-first regulatory/product posture         |
| [0004](0004-self-signup-professional-invitation.md)  | Self-signup + professional invitation          |
| [0005](0005-private-professional-notes.md)           | Private professional notes                     |
| [0006](0006-consent-first-authorization.md)          | Consent-first authorization                    |
| [0007](0007-layered-authorization.md)                | RBAC + relationship + consent + ABAC           |
| [0008](0008-postgres-rls-defense-in-depth.md)        | PostgreSQL + RLS defense-in-depth              |
| [0009](0009-modular-monolith.md)                     | Modular monolith instead of microservices      |
| [0010](0010-typed-aggregates-timeline-projection.md) | Typed domain aggregates + timeline projection  |
| [0011](0011-ai-context-broker.md)                    | AI Context Broker as only AI data path         |
| [0012](0012-human-approval-ai-actions.md)            | Human approval for record-bound/outbound AI    |
| [0013](0013-documentation-ai-attestation.md)         | Documentation AI with professional attestation |
| [0014](0014-transactional-outbox.md)                 | Transactional outbox for async workflows       |

## ADR change control (binding)

Core architectural decisions cannot change silently through implementation.

Any change to a **core ADR** (0001, 0005, 0006, 0007, 0008, 0011, 0012, 0013) or to `CONTRACT-v0.2.md` requires **all** of:

1. **Identified contradiction, security flaw, or impossible constraint** — not preference or speed.
2. **ADR amendment** — new ADR that supersedes or amends, with status transitions recorded.
3. **Impact analysis** — modules, APIs, data, tests affected.
4. **Security impact review** — invariants touched (`docs/security/SECURITY-INVARIANTS.md`).
5. **Dependency / data migration impact** — package graph and future schema implications.
6. **Explicit architecture approval** — recorded in the superseding ADR (`Deciders` + date).

**Implementation convenience is NOT sufficient justification.**

### Template

```markdown
# ADR-NNNN — Title

- Status: Proposed | Accepted | Superseded by ADR-XXXX
- Date: YYYY-MM-DD
- Deciders: …

## Context

## Decision

## Alternatives considered

## Why chosen

## Consequences

## Reversal cost

## Migration path

## Security impact
```
