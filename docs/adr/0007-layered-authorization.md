# ADR-0007 — Layered authorization (RBAC + relationship + consent + ABAC)

- Status: **Accepted (FROZEN)**
- Date: 2026-09-22
- Deciders: Principal Architect

## Context

Single-mechanism authz cannot express role-specific health visibility and purpose binding (AI vs treatment vs coordination).

## Decision

Every health-data request passes a fixed pipeline:

1. Authentication
2. RBAC (principal type + role types)
3. Relationship (active CareTeamMembership)
4. Consent (category × purpose × grantee × validity)
5. ABAC/context (resource attributes, data class, break-glass)
6. Minimum-necessary projection
7. AccessGrant dereference → audit basis stamp

Fail-closed. Single policy module is the central Policy Enforcement Point. Database RLS is an independent second gate (ADR-0008).

## Alternatives considered

1. External OPA/Cedar PDP — deferred; pure functions keep an extraction seam.
2. Ad-hoc per-endpoint checks — rejected: bypass bugs.
3. RBAC only — rejected: cannot express categories/purposes.

## Why chosen

Each layer maps to a real constraint; decisions are unit-testable pure functions.

## Consequences

Authorization matrix becomes executable tests; endpoints must declare purpose.

## Reversal cost

**High** (externalization path exists if needed).

## Migration path

Data-shaped decisions can export to Cedar/OPA later without product redesign.

## Security impact

Core ADR. Supports I-1, I-3, I-9, I-19. `packages/permissions` is the future PEP home; it must not depend on frameworks or AI providers.
