# ADR-0003 — India-first regulatory/product posture

- Status: **Accepted (FROZEN)**
- Date: 2026-09-22
- Deciders: Product owner (locked D1), Principal Architect

## Context

Initial market is India. DPDP-shaped obligations and health/fitness product realities affect consent, notice, principal rights, children’s data, retention, breach handling, and cross-border transfer. Compliance must not be claimed without legal validation.

## Decision

- Design posture: users as Data Principals; platform as Data Fiduciary **in posture only**, pending legal confirmation.
- Seams required: purpose-bound consent evidence, notice/version capture, rights workflows (access/correction/erasure/grievance), retention limitation, breach playbooks, consent audit, optional consent-manager interoperability later.
- MVP age policy: **18+ self-managed accounts** (locked); under-18 parental flow deferred with seam only.
- Region-pinning supported in deployment design (India region first); LLM egress flagged for legal review before enabling non-India inference.
- **No compliance badges** (no “DPDP certified”, no “HIPAA compliant”) until counsel validates.
- International expansion = region + notice/consent pack swap; domain model unchanged.

## Alternatives considered

1. Generic global posture — rejected: locked D1.
2. ABDM/ABHA integration at MVP — rejected: interoperability is LATER.
3. Early compliance claims — rejected: irresponsible.

## Why chosen

Seams are cheap now, ruinous later.

## Consequences

Legal review gate before production data. Copy for notice/consent needs counsel.

## Reversal cost

**High** if retrofitted (erasure/retention/consent evidence).

## Migration path

ABDM/FHIR mapping later on observation/assessment codes without schema rewrite.

## Security impact

Cross-border AI provider flows are a RED risk until legal sign-off; kill-switch required before real provider keys (Phase 9–10 gate).

## Legal validation required before production (non-exhaustive)

DPDP consent/notice wording · Data Principal rights SLAs · children’s data · retention per class · cross-border LLM transfer · breach runbook · consent-manager integration need · sectoral health-record guidance · grievance redressal.
