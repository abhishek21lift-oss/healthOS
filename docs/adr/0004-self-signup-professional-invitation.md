# ADR-0004 — Self-signup + professional invitation

- Status: **Accepted (FROZEN)**
- Date: 2026-09-22
- Deciders: Product owner (locked D3), Principal Architect

## Context

Two entry doors into one person graph create duplicate-person, wrong-recipient, takeover, and implicit-consent risks.

## Decision

- **Flow A (person-first):** self-register → create/claim Person → invite/discover professional via invite code/link → professional accepts membership → person grants consent → AccessGrant compiles → care begins.
- **Flow B (professional-first):** professional/org issues single-use short-TTL signed invitation bound to a contact point → invitee authenticates or registers → claim or create Person → review requested access → accept/reject consent → relationship activates.
- Invitation never pre-grants health access; consent acceptance is always an explicit person action after identity establishment.
- Identity ↔ Person is 1:1 in MVP; claim rules prevent forking on verified contact match.
- Discovery is invite/code-based only (no public directory).

## Alternatives considered

1. Invite-only closed product — rejected: kills B2C self-signup.
2. Professional invite implies consent — rejected: consent bypass.
3. Phone-OTP-only identity — rejected: insufficient sole factor posture.

## Why chosen

Both flows converge on the same Consent → Grant compile path.

## Consequences

Invite lifecycle and anti-abuse are MVP-critical (Phase 4), not polish.

## Reversal cost

**Medium** (auth UX + invite tables).

## Migration path

Passkeys/OIDC behind Identity interface.

## Security impact

Supports I-13, I-17. Invite token hashing/TTL/single-use are mandatory acceptance criteria in Phase 4.
