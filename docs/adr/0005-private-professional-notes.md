# ADR-0005 — Private professional notes

- Status: **Accepted (FROZEN)**
- Date: 2026-09-22
- Deciders: Product owner (locked D4), Principal Architect

## Context

Professionals need working notes that are not shared health record. UI-hiding shared data is insufficient; classification must be structural.

## Decision

- Entity `PrivateProfessionalNote`, data class **PROFESSIONAL_PRIVATE**, stored outside shared clinical read paths (dedicated isolation rules in Phase 6).
- Author-only create/read/update/void.
- Not on shared timeline; not person-visible; not org-admin-visible (content or counts in MVP); not readable by other professionals.
- Not AI-readable unless a task registry entry explicitly allows the class ∧ principal is the author ∧ note ids are explicitly selected ∧ purpose is `ai_assistance`. MVP: only Documentation AI may allow author-selected notes; Summary and Handoff tasks prohibit the class.
- Cross-professional exposure only via **explicit promotion** (copy into a shared entity with new provenance); original stays private.
- Person disclosure only via rights-request workflow (process), not default API grant.
- Fully audited (reads severity=high), retained under per-class policy seams.

## Alternatives considered

1. Internal flag on shared notes — rejected: same table, easy bypass.
2. Org-owned notes — rejected: breaks authorship/portability.
3. No private notes — rejected: locked D4.

## Why chosen

Separate class + policy tests make leakage a failing test, not a UI bug.

## Consequences

Promotion UX required; AI features branch on classification.

## Reversal cost

**Medium–high** if bolted on later (retro-classification of all notes).

## Migration path

None — build when private notes ship (Phase 6).

## Security impact

Supports I-4, I-5, I-15, I-16. Hiding-only implementations are non-compliant with this ADR.
