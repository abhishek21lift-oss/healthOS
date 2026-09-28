# ADR-0006 — Consent-first authorization

- Status: **Accepted (FROZEN)**
- Date: 2026-09-22
- Deciders: Principal Architect (v0.1→v0.2), Product owner lock-in via D2/D4

## Context

Care-team membership alone over-shares. Org pressure in B2B worsens this. Consent must be both ethical center and evidence artifact.

## Decision

- No professional health access without: active Consent revision covering grantee, category, purpose, time window **and** active CareTeamMembership **and** satisfied RBAC.
- Consent is person-issued, versioned, append-only revisions.
- Revocation is immediate on next request (cache staleness ≤ 5 seconds) and invalidates in-flight AIContexts.
- `AccessGrant` is the compiled decision artifact (audit + fast path), always recomputable from consent + membership + context.

## Alternatives considered

1. Membership-only ACL — rejected: no purpose/expiry/categories.
2. Org policy only — rejected: not person-authoritative.
3. Pure ABAC without consent object — rejected: loses principal-facing evidence.

## Why chosen

Consent is both product principle and India-first evidence shape.

## Consequences

Pre-consent states must show zero health reads. Consent UX must be excellent.

## Reversal cost

**Very high**.

## Migration path

Consent Manager interoperability may become an alternate evidence **source** feeding the same compiler.

## Security impact

Supports I-1, I-2, I-9, I-18, I-19. Core ADR — changes require full change-control process.
