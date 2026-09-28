# ADR-0011 — AI Context Broker as the only AI data-access path

- Status: **Accepted (FROZEN)**
- Date: 2026-09-22
- Deciders: Principal Architect (v0.1→v0.2)

## Context

An LLM with database tools is an uncontrolled exfiltration surface; prompt injection becomes context-RCE.

## Decision

- Models receive only an assembled `AIContext` payload.
- The broker executes allow-listed, parameterized retrieval through domain services after the human principal’s authorization pipeline has already passed.
- Model has no DB credentials, no dynamic SQL tool, no “fetch more” tool, no cross-person lookup.
- Every assembly persists `AIContext` + `AIContextSource` rows (refs, class, grant basis).

Pipeline (normative):

```text
Task Registry → Context Broker → AI Provider → Validator → Human Gate
```

## Alternatives considered

1. Function-calling tools with authz middleware — rejected: larger tool attack surface; harder minimum-necessary proofs.
2. Model with DB access — rejected.
3. Manual context paste — rejected: unscalable, unauditable.

## Why chosen

Provable data path; traceability; testable invariant (no AI call without context row).

## Consequences

New capabilities require new retrieval templates + registry entries, not freeform tools.

## Reversal cost

**High** to loosen (and must not be loosened casually).

## Migration path

Broker internals may stream from future FHIR services without changing the invariant.

## Security impact

Core ADR. Supports I-6, I-18, I-19. Package boundaries in Phase 0 forbid domain→AI and will forbid AI→unmediated database use when AI packages appear.
