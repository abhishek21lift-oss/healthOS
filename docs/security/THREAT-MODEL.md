# Threat Model (Baseline — updated per phase)

Scope of this document at Phase 0: **structural and supply-chain threats** plus the standing product threats from Contract v0.2 §14 for later phases.

## Phase 0 threats and controls

| Threat                           | Control now                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| Secrets committed to repo        | `.gitignore`; no secret files; `.env.example` only; CI fails on obvious secret patterns (basic)   |
| Dependency supply chain          | Lockfile frozen install; `pnpm deps:audit`; pinned Node/pnpm; minimal initial dep set             |
| Silent architecture drift        | dependency-cruiser boundaries; architecture tests; ADR change control                             |
| Weakened local vs CI gates       | Same `pnpm verify` script locally and in CI; no `continue-on-error` on quality gates              |
| Insecure defaults shipping early | No production server configs; no CORS wildcards; apps are non-listening shells                    |
| PHI logging                      | No health code; repository rule: never log health payloads (documented; enforced as code matures) |

## Product threats (deferred to implementation phases)

Full list remains Contract v0.2 §14: invitation abuse, org admin abuse, private note leakage, AI context leakage, prompt injection, cross-person access, stale/revoked consent, presigned URL leaks, exports, audit tampering, model/provider leakage, insider access.

Security invariants: `SECURITY-INVARIANTS.md`.

## Review cadence

- Re-read threat model at end of Phase 5 and Phase 11.
- Any ADR security-impact review must update this file or link an amendment.
