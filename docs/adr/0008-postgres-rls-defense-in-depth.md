# ADR-0008 — PostgreSQL + RLS defense-in-depth

- Status: **Accepted (FROZEN)**
- Date: 2026-09-22
- Deciders: Principal Architect

## Context

IDOR/BOLA is the dominant health API failure mode; app-layer bugs happen.

## Decision

- PostgreSQL is the system of record; RLS enabled on every person-scoped table when introduced (Phase 2).
- App runtime role: no `BYPASSRLS`, not superuser; separate migrator role.
- Per-request session context variables for principal/purpose/person scope/grant id.
- App policy engine remains primary semantic source; RLS catches omission bugs.
- Tests must attempt cross-person access and expect denial.

## Alternatives considered

1. App-only authz — rejected: single point of failure.
2. DB-per-tenant — rejected: operational waste now.
3. Early sharding — premature.

## Why chosen

Mature, testable, deployable on any managed Postgres (India region capable).

## Consequences

Connection/session discipline required from Phase 2.

## Reversal cost

**Medium** (additive; removing later weakens defense — do not remove).

## Migration path

Multi-region revisit for partitioning only, not authz model.

## Security impact

Supports I-1, I-10, I-11. Runtime not available until Phase 2 — documented gap until then.
