# ADR-0001 — Person-centric health data model

- Status: **Accepted (FROZEN)**
- Date: 2026-09-22
- Deciders: Product owner (locked D2), Principal Architect

## Context

Health systems often center the organization. Health Collaboration OS must keep one longitudinal graph around the **person** under hybrid B2B+B2C without recreating silos.

## Decision

- `person_id` is the root and isolation key for all health-bearing data.
- Organizations never own or receive blanket access to person health data.
- Access always resolves: identity → care relationship → consent → category/purpose → minimum necessary.
- Org affiliation is never a health ACL.

## Alternatives considered

1. Org-owned tenancy (classic EHR) — rejected: contradicts person-centric principle; blocks B2C.
2. Shared co-ownership — rejected: contested authority.
3. Org read-through by membership — rejected: consent bypass.

## Why chosen

Implements principle #1; one access path for B2B and B2C; aligns with data-subject authority postures (India-first portability).

## Consequences

Org views are derived relationship operational data only. Sales motions promising org ownership of charts are off-strategy.

## Reversal cost

**Very high** (touches every table, policy, product surface).

## Migration path

None intended. Future legal “fiduciary” roles are legal roles, not data re-ownership.

## Security impact

Foundational for I-1, I-3, I-11. Weakening this ADR requires full security re-review.
