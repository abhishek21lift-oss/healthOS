# Authentication Architecture

**Phase:** 3 — Identity, Authentication, Sessions, Invitation Tokens  
**Package:** `packages/auth`  
**Related:** `docs/security/IDENTITY-SECURITY.md`, `docs/security/RLS-MODEL.md`, ADR-0004, ADR-0008

## Goals

1. Establish trusted principal identity from a session token.
2. Register / verify / login / logout with enumeration-resistant failures.
3. Issue, rotate, expire, and revoke sessions (idle + absolute).
4. Single-use invitation token claim primitives (I-17 safe).
5. Zero change to health authorization rules.

## Non-goals

- Consent, AccessGrant evaluation, clinical APIs, directory UI, AI, OAuth/SSO.

## Layering

```text
apps/api (future routes)
    │
    ▼
packages/auth  services.ts
    │  registerAccount / verifyEmail / login / logout
    │  resolveSession / rotateSession / revokeSessionById
    │  createInvitation / claimInvitation
    │  withSessionPrincipalContext
    │
    ├── password.ts (scrypt) · tokens.ts (hash) · age.ts
    ├── rate-limit.ts · cookies.ts · csrf.ts · session-policy.ts
    ├── security-events.ts · contact.ts
    │
    ▼
@health-os/database
    runInSystemContext  → identity tables (system principal)
    runInPrincipalContext ← withSessionPrincipalContext (health principal)
```

`auth` must not import `@health-os/permissions`. Boundary rule: **auth is not the authorization engine**.

## System principal vs session principal

| Path                     | Principal                            | Allowed tables                                                                    |
| ------------------------ | ------------------------------------ | --------------------------------------------------------------------------------- |
| Auth identity ops        | `system` + fixed UUID                | accounts, contact_points, tokens, sessions, invitations, persons (identity shell) |
| Authenticated health ops | `person` \| `professional` + purpose | health-bearing tables under RLS                                                   |

`toPrincipalContext` maps AuthenticatedPrincipal → PrincipalContext. An account with neither person nor professional link cannot act on health data via RLS (system fallback with account id does not satisfy health policies).

## Request lifecycle (future HTTP)

1. Read session cookie (`health_os_session`).
2. `resolveSession` → null ⇒ 401; else principal.
3. For state-changing methods: `validateCsrf` with session `csrf_token` + header + Origin.
4. For health endpoints: `withSessionPrincipalContext(token, purpose, …)` — purpose must be declared; never client-supplied principal ids.
5. Security events → redaction assert → audit sink.

## Session state machine

```text
minted ──active──► idle_expired | absolute_expired | revoked
                      │                │               │
                      └── resolve → null (fail closed) ─┘
```

- `isSessionActive`: not revoked ∧ now ≤ expires_at ∧ now ≤ absolute_expires_at.
- Idle window refreshed only while activity within 30 minutes of `last_seen_at`.

## Invitation claim flow

```text
createInvitation → raw token once → hashed in invitations.token_hash
claimInvitation(token, claimantEmail)
  → rate limit → hash lookup → pending + TTL + recipient match
  → reuse person on contact/account match (I-17)
  → CAS status accepted + consumed_at
  → security event
```

No care-team, consent, or AccessGrant rows are written.

## Rate limiting

In-process `RateLimiter` keyed `endpoint:scope`. Specs in IDENTITY-SECURITY.md. Injectable `AuthDeps.limiter` for tests (`reset()` in `beforeEach`).

## Test strategy

| Suite                                            | Covers                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| `packages/auth/src/index.test.ts`                | Unit: password, tokens, age, csrf, cookies, limiter, session policy |
| `packages/auth/src/services.integration.test.ts` | Full flows on real PG as `health_app` (FORCE RLS)                   |
| `packages/database/src/rls.test.ts`              | Phase 2 health RLS still green                                      |
| `tests/architecture/*`                           | Boundaries + freeze                                                 |

Integration uses unique `ipHint` per call so IP rate limits do not cross-contaminate tests; migrations serialized with `pg_advisory_xact_lock(4_200_111)`.

## Deviations (documented)

| Deviation                                          | Why                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| `auth → database` allowed (not in forbidden pairs) | Phase 3 persistence requirement; no `auth → permissions`         |
| `persons_select` allows `system` (0012)            | INSERT…RETURNING under FORCE RLS needs row visibility for system |
| In-memory rate limiter                             | MVP minimum; interface allows Redis swap later                   |

## Phase boundary

**Stop after Phase 3.** Do not start Phase 4 (directory, care team, invitation UX flows beyond token claim primitives) without separate authorization.
