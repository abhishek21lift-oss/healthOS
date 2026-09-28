# Identity Security

**Normative references:** SECURITY-INVARIANTS I-13, I-17, CONTRACT-v0.2 D3/D6, ADR-0004, ADR-0008.  
**Scope:** Phase 3 — identity records, authentication, sessions, invitation tokens. Not authorization.

## Principle

Authentication answers **who is making the request**. It must never answer **what health data may they access**. Health access remains AccessGrant ∧ purpose ∧ membership ∧ RLS (Phase 2/5).

## Identity tables (migration 0011)

| Table                       | Purpose                                          | Key columns                                         |
| --------------------------- | ------------------------------------------------ | --------------------------------------------------- |
| `accounts`                  | Login identity; linked to person or professional | `email_normalized` UNIQUE, `password_hash`, status  |
| `contact_points`            | Verified/unverified email (and later phone)      | `kind`, `normalized_value` UNIQUE                   |
| `email_verification_tokens` | Single-use email verification                    | `token_hash` bytea, `expires_at`, `consumed_at`     |
| `sessions`                  | Bearer session (hashed)                          | `token_hash` UNIQUE, idle + absolute TTLs           |
| `auth_security_events`      | Security telemetry (no secrets)                  | `event_type`, `contact_hint`, `ip_hint`             |
| `invitations`               | Invitation tokens (extended in 0011)             | `token_hash`, `recipient_normalized`, `consumed_at` |

`persons` remains the person shell (display_name, is_adult only) — not a health-data grant.

## Password storage (I-13)

- Algorithm: **Node.js `crypto.scrypt`** — N=16384, r=8, p=1, 32-byte salt, 64-byte key.
- Stored format: `scrypt$N$r$p$saltB64$hashB64` (parameters embedded for future rehash).
- Verification uses `timingSafeEqual`.
- Never custom crypto; never plaintext; never logged.
- Policy: min 12 chars, max 1024 (DoS bound).

## Enumeration resistance

| Surface            | Mitigation                                                                   |
| ------------------ | ---------------------------------------------------------------------------- |
| Login unknown user | `dummyVerify` still runs scrypt; external message always `Unable to sign in` |
| Registration       | External message always generic; internal `duplicate_identity` only          |
| Email verify       | Invalid and expired collapse to `Invalid or expired link`                    |
| Invitation claim   | Invalid / expired / wrong recipient collapse to one message                  |

Security events may carry `contact_hint` (truncated) for ops — never the full token.

## Tokens (I-13)

| Token              | Generation               | Storage                           | TTL                |
| ------------------ | ------------------------ | --------------------------------- | ------------------ |
| Email verification | `randomBytes(32)` b64url | SHA-256 → `token_hash` bytea      | 24 hours           |
| Session            | `randomBytes(32)` b64url | SHA-256 → `token_hash` bytea      | idle 30m / abs 12h |
| Invitation         | `randomBytes(32)` b64url | SHA-256 → `token_hash` bytea      | 7 days             |
| CSRF               | `randomBytes(32)` b64url | session row `csrf_token` (opaque) | session lifetime   |

Raw tokens are returned once to the caller and never stored, logged, or put in security-event metadata.

## Session security

- **Fixation:** every login mints a new session id/token; rotation (`rotateSession`) revokes the previous token and issues a new one.
- **Idle TTL:** 30 minutes (`SESSION_IDLE_MS`); resolve touches `last_seen_at`.
- **Absolute TTL:** 12 hours (`SESSION_ABSOLUTE_MS`) — cannot be extended by activity.
- **Revocation:** logout, admin revoke, idle expiry, absolute expiry, account not active.
- **Cookies:** production defaults `Secure`, `HttpOnly`, `SameSite=Lax` (`productionSessionCookieOptions`). `sessionCookieIsSecure` gates production.
- **CSRF:** synchronizer token in session + `x-csrf-token` header; state-changing methods only; Origin checked against allow-list (`validateCsrf`). SameSite alone is not sufficient.

## Rate limits (in-memory sliding window)

| Endpoint key                | Limit | Window   |
| --------------------------- | ----- | -------- |
| `registrationPerIp`         | 5     | 1 hour   |
| `registrationPerEmail`      | 3     | 24 hours |
| `loginPerIp`                | 20    | 15 min   |
| `loginPerEmail`             | 5     | 15 min   |
| `verificationPerEmail`      | 10    | 1 hour   |
| `invitationClaimPerIp`      | 10    | 1 hour   |
| `invitationClaimPerContact` | 5     | 1 hour   |

Limit failures emit `rate_limited` (no secrets) and throw `AuthError('rate_limited')`. Store is swappable for Redis later without changing call sites.

## Account lockout

After **5** consecutive failed passwords (`MAX_FAILED_LOGINS`), account locks for **15 minutes** (`LOCKOUT_MS`). Successful login clears `failed_login_count` and `locked_until`.

## Invitation claims (I-17)

- Single-use: `consumed_at` + `status='accepted'` CAS update; concurrent second claim loses.
- Recipient-bound: claimant email must match `recipient_normalized` / contact.
- TTL: default 7 days.
- **Never fork person** on existing `contact_points` or account email match — reuse `person_id`.
- Claim does **not** grant health access, consent, or care-team membership.

## Age gate (D6)

Registration requires birthDate such that subject is **18+** at `now`. Under-18 → `AuthError('under_18')` with generic external message. MVP accounts are adult-only.

## Auth security events

Emitted via `onSecurityEvent` after `assertNoSecrets`: registration success/failure, email verification success/failure, login success/failure, logout, session created/rotated/revoked, invitation created/claim success/failure, rate_limited, suspicious_replay. Persisted subset also written to `auth_security_events` inside the system-context transaction.

## Trusted `system` principal

All identity-table access runs as fixed system principal `00000000-0000-0000-0000-000000000001` with purpose `auth:*` via `runInSystemContext` (migration 0012 allows `persons_select` for system so `INSERT … RETURNING` succeeds under FORCE RLS). Clients never choose this principal. Health-data paths continue to use `withSessionPrincipalContext` → person/professional principal only.

## What Phase 3 does NOT provide

- Authorization / AccessGrant decisions (Phases 5+)
- OAuth / SSO / passkeys / Aadhaar
- Public directory discovery
- Transport TLS termination (deploy concern)
- Production rate-limit store (Redis)
- Email delivery provider (token issued only)
