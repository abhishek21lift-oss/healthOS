# ADR-0002 — Hybrid B2B + B2C product model

- Status: **Accepted (FROZEN)**
- Date: 2026-09-22
- Deciders: Product owner (locked D2), Principal Architect

## Context

Organizations (clinics, physio practices, gyms) and individuals both onboard the product. Two commercial motions must not fork the permission system.

## Decision

- One product, one authorization stack.
- Org-assisted path: org onboards professionals; org or professional may invite persons; person still grants consent per professional.
- Direct path: person self-signups and invites professionals; no org required.
- Persons are never org members in the health model.
- Org admins see roster, invitation status, affiliation, operational metadata — never health content (and never private-note counts in MVP).

## Alternatives considered

1. Separate SKUs/tenancy models — rejected: doubles policy complexity.
2. C2C stripped lite — rejected: forks the domain.
3. B2B-only first — rejected: locked out of B2C.

## Why chosen

Org features become additive projections over the same grant path.

## Consequences

Early org analytics intentionally limited. Practice-management features (billing/scheduling) stay out of MVP.

## Reversal cost

**Medium–high** (product/UX rework; domain mostly stable).

## Migration path

Org aggregate reporting later as a separate derived read model with its own review.

## Security impact

Preserves I-3. Any feature that adds org health reads requires a superseding ADR + security review.
