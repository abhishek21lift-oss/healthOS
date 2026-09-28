# ADR-0012 — Human approval for record-bound and outbound AI actions

- Status: **Accepted (FROZEN)**
- Date: 2026-09-22
- Deciders: Product owner (D5), Principal Architect

## Context

AI must not silently diagnose, prescribe, attest, or message persons. Professionals remain responsible for final records.

## Decision

- Output classes:
  - `informational_draft` — shown to requester, watermarked, not record-bound
  - `record_bound` — requires professional approval before entering shared record
  - `outbound` — requires approval before any person/other-professional delivery
- Approval is an explicit authenticated action bound to `AIInteraction.id`; no batch “approve all” in MVP.
- AI never receives SIGN/attest capability as a tool.

## Alternatives considered

1. Fully autonomous AI writes — rejected by product red lines.
2. Human review only on “risky” tasks — rejected: fuzzy boundary; registry defaults deny.
3. Out-of-band review queues — rejected: loses context binding.

## Why chosen

Professional accountability stays human (locked D5).

## Consequences

Approval UX must be fast and evidence-rich or become rubber-stamping (citations required).

## Reversal cost

**Very high** to remove.

## Migration path

None desirable; any auto-promote needs a superseding ADR, not a quiet code change.

## Security impact

Core ADR. Supports I-7, I-8. Runtime enforcement Phases 9–10.
