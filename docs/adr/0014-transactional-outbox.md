# ADR-0014 — Transactional outbox for asynchronous workflows

- Status: **Accepted (FROZEN)**
- Date: 2026-09-22
- Deciders: Principal Architect

## Context

The modular monolith needs reliable async (projections, notifications, AI jobs, invite expiry) without dual-write bugs.

## Decision

- Domain state change + outbox row in the **same database transaction** (Phase 2+).
- Worker drains outbox at-least-once with idempotent consumers, backoff, and dead-letter status on the row.
- Postgres-backed queue approach for MVP — no Redis/Kafka required.
- Consumers include: timeline projection, notifications, AI job kickoff, consent-revocation fanout, invite expiry.

## Alternatives considered

1. In-process fire-and-forget — rejected: loss on crash.
2. Kafka — premature.
3. Redis-only streams — extra infra; weaker durability story than Postgres for MVP.
4. Dual-write to external queue — rejected: inconsistency.

## Why chosen

Correctness-first; single datastore; still swappable.

## Consequences

Brief projection lag possible; hot paths may write-through for read-your-writes (decided in Phase 7).

## Reversal cost

**Low–medium**.

## Migration path

Publisher can emit to SQS/NATS later without changing domain code.

## Security impact

Outbox payloads must prefer ids over PHI bodies (supports I-12/I-16 when notifications and events appear).
