# ADR-0009 — Modular monolith instead of microservices

- Status: **Accepted (FROZEN)**
- Date: 2026-09-22
- Deciders: Principal Architect

## Context

Consent, audit, and health writes are transactionally related. Distributed systems are premature without a concrete scaling trigger.

## Decision

- One API deployable (modular composition), one worker, one web app, one database (when introduced).
- Module boundaries enforced in CI via dependency-cruiser (Phase 0) — no cross-module forbidden imports.
- Async only through transactional outbox (ADR-0014).

## Alternatives considered

1. Microservices per domain — rejected: distributed consent transactions; no trigger.
2. Serverless function mesh — rejected: cohesive policy engine harder.
3. Unstructured monolith — rejected: inevitable mud without enforced boundaries.

## Why chosen

Correctness and auditability over speculative scale.

## Consequences

CI boundary gate is mandatory; connection budgets managed when DB exists.

## Reversal cost

**Low–medium** to extract a module later **if** boundaries held.

## Migration path

Extract worker-side AI or notifications first if metrics demand; never split consent/authz first.

## Security impact

Supports reviewability of I-1 paths in one process. Boundary rules are the Phase 0 embodiment of this ADR.
