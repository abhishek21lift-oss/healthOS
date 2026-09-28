# ADR-0010 — Typed domain aggregates + timeline projection

- Status: **Accepted (FROZEN)**
- Date: 2026-09-22
- Deciders: Principal Architect

## Context

A single polymorphic health-event table harms type safety; full event sourcing is overkill; free-text-only destroys longitudinal queries.

## Decision

- Writes go to typed aggregates with invariants in `packages/domain`.
- `timeline_entry` is a derived projection (rebuildable) for the canonical longitudinal view.
- Corrections use amendment/supersession; no silent hard-delete of signed records.
- Private professional notes and unapproved AI drafts are excluded from the shared projection.

## Alternatives considered

1. Event-sourced ledger — rejected: operational complexity without requirement.
2. JSONB catch-all events — rejected: query/index pain.
3. Client-side timeline merge — rejected: inconsistent permissions.

## Why chosen

Balances integrity, queryability, and stable AI retrieval surfaces.

## Consequences

Projection builders must be complete per aggregate; parity tests required.

## Reversal cost

**Medium–high**.

## Migration path

Add event types via registry; rebuild jobs tolerate shape versions.

## Security impact

Supports I-5 (exclusions) and minimum-necessary reads. Permission filtering remains at read time (ADR-0007), not trusted solely from projection cache columns.
