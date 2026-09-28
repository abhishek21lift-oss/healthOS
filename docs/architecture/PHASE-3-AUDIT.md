# Phase 3 Audit — Identity, Authentication, Sessions, Invitation Tokens

**Date:** 2026-09-22  
**Contract:** `docs/architecture/CONTRACT-v0.2.md` (**FROZEN**)  
**Scope:** Phase 3 only — who is making the request. No clinical APIs, consent engine, health authorization changes, AI, directory UI, OAuth/SSO.  
**Overall result:** **PASS**

---

## 1. Deliverables

| Artifact                           | Location                                                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Migration identity+auth            | `packages/database/migrations/0011_identity_auth.sql`                                                                      |
| Migration system SELECT on persons | `packages/database/migrations/0012_persons_select_system.sql`                                                              |
| System principal context           | `packages/database/src/pool.ts` (`runInSystemContext`, `beginSystemContext`)                                               |
| Migration advisory lock            | `packages/database/src/migrate.ts` (`pg_advisory_xact_lock(4_200_111)`)                                                    |
| Auth package                       | `packages/auth/src/{contact,password,tokens,age,rate-limit,cookies,csrf,security-events,session-policy,services,index}.ts` |
| Unit tests                         | `packages/auth/src/index.test.ts`                                                                                          |
| Integration tests                  | `packages/auth/src/services.integration.test.ts` (21 tests)                                                                |
| API phase flag                     | `apps/api` status `authReady` / phase 3 shell                                                                              |
| Vitest split                       | `vitest.config.ts` unit vs database projects (`fileParallelism: false` for DB)                                             |
| Identity security doc              | `docs/security/IDENTITY-SECURITY.md`                                                                                       |
| Auth architecture doc              | `docs/architecture/AUTHENTICATION-ARCHITECTURE.md`                                                                         |
| This audit                         | `docs/architecture/PHASE-3-AUDIT.md`                                                                                       |

Auth source modules: `contact.ts`, `password.ts`, `tokens.ts`, `age.ts`, `rate-limit.ts`, `cookies.ts`, `csrf.ts`, `security-events.ts`, `session-policy.ts`, `services.ts`, `index.ts` (`AUTH_READY = true`).

---

## 2. What was implemented

- **Registration:** normalize email, rate limit IP+email, 18+ gate, scrypt hash, person shell + account + unverified contact + verification token (hashed).
- **Email verification:** hashed single-use token, consume CAS, activate account, verify contact.
- **Login:** rate limit IP+email, dummyVerify on unknown user, lockout after 5 fails / 15 min, mint session (fixation defense), generic external errors.
- **Logout / resolve / rotate / revoke:** hashed session tokens; idle 30m + absolute 12h; rotation revokes previous; security events without secrets.
- **Invitations:** create (hashed, TTL 7d) and claim (single-use, recipient-bound, I-17 no person fork).
- **Principal bridge:** `withSessionPrincipalContext` → `runInPrincipalContext` with purpose; clients never choose principal ids.
- **CSRF + cookie helpers:** synchronizer token; production Secure/HttpOnly/SameSite=Lax defaults.
- **Rate limiter:** sliding window, documented limits, injectable for tests.
- **System context:** all identity CRUD under fixed system principal under FORCE RLS.

---

## 3. Security invariants — Phase 3 classification

| ID        | Invariant                                  | Phase 3 status              | Evidence                                                                                            |
| --------- | ------------------------------------------ | --------------------------- | --------------------------------------------------------------------------------------------------- |
| I-1…I-9   | Health access / consent / revoke           | **UNCHANGED (Phase 2 RLS)** | `rls.test.ts` 28/28 still green; no AccessGrant code in auth                                        |
| I-10      | Audit immutable                            | **UNCHANGED**               | no UPDATE/DELETE on audit; auth inserts only                                                        |
| I-11      | Cross-person ⇒ 404                         | **N/A HTTP**                | no health HTTP routes in Phase 3                                                                    |
| I-12      | No SHARED/HIGH in notifications            | N/A                         | no notification code                                                                                |
| I-13      | Secrets/tokens hashed, never logged        | **ENFORCED**                | scrypt + SHA-256 token_hash; `assertNoSecrets`; raw returned once only; unit+integration assertions |
| I-14…I-16 | Break-glass / export / log redaction       | Later                       | documented                                                                                          |
| I-17      | Invite never forks person on contact match | **ENFORCED**                | claim reuses `contact_points.person_id` / account person; tests                                     |
| I-18…I-19 | AI purpose / deny default                  | N/A                         | no AI                                                                                               |
| I-20      | One open care team                         | **UNCHANGED**               | Phase 2 unique index; auth writes no care-team rows                                                 |

Additional Phase 3 controls: enumeration resistance, session fixation rotation, CSRF, cookie flags, rate limits, account lockout, age gate, single-use TTL tokens.

---

## 4. Executable proof summary

Integration tests (`services.integration.test.ts`) against real PostgreSQL as **`health_app`** (FORCE RLS):

1. register → verify → login happy path; session token issued
2. under-18 rejected; weak password rejected
3. duplicate email generic failure
4. login wrong password then lockout; correct password while locked fails
5. unknown account same external message as bad password (enumeration)
6. email verify invalid / expired / replay
7. logout revokes; resolve null after revoke
8. idle/absolute expiry; expired session rejected (CHECK-safe fixture update)
9. rotate issues new token; old token dead
10. invitation create/claim; wrong recipient; expired; unknown token; double claim
11. I-17: claim reuses existing person
12. withSessionPrincipalContext sets principal; purpose required
13. rate_limited event on registration per-email limit
14. no raw tokens/passwords in security events (`assertNoSecrets`)

**Result: 179/179 tests PASS overall (21 files), including 28 RLS regression + 21 auth integration + auth units + architecture tests.**

---

## 5. Quality gates

| Gate             | Command                                  | Result             |
| ---------------- | ---------------------------------------- | ------------------ |
| Format           | `pnpm format:check`                      | PASS               |
| Lint             | `pnpm lint`                              | PASS               |
| Typecheck        | `pnpm typecheck` + `pnpm typecheck:root` | PASS               |
| Tests            | `pnpm test`                              | **PASS — 179/179** |
| Boundaries       | `pnpm boundaries`                        | PASS               |
| Build            | `pnpm build`                             | PASS               |
| Dependency audit | `pnpm deps:audit`                        | PASS               |
| Canonical        | `pnpm verify`                            | PASS               |

No `any`, `@ts-ignore`, `eslint-disable`, `continue-on-error`.

---

## 6. Security invariants I-1…I-20 — Phase 3 re-review

| ID        | Re-review verdict  | Notes                                                                         |
| --------- | ------------------ | ----------------------------------------------------------------------------- |
| I-1       | **HOLD**           | Auth does not read health tables; system principal not used for health grants |
| I-2       | **HOLD**           | No consent endpoints                                                          |
| I-3       | **HOLD**           | Org membership never consulted in auth                                        |
| I-4       | **HOLD**           | Private notes untouched                                                       |
| I-5       | **HOLD**           | No timeline/handoff                                                           |
| I-6…I-8   | **HOLD**           | No AI                                                                         |
| I-9       | **HOLD**           | Session revoke ≠ consent revoke; RLS still immediate                          |
| I-10      | **HOLD**           | Audit privileges unchanged                                                    |
| I-11      | **HOLD**           | No health HTTP                                                                |
| I-12      | **HOLD**           | No notifications                                                              |
| I-13      | **PASS (Phase 3)** | Hashing + no-log + assertNoSecrets + tests                                    |
| I-14…I-16 | **HOLD**           | Later phases                                                                  |
| I-17      | **PASS (Phase 3)** | Invitation claim person reuse + tests                                         |
| I-18…I-19 | **HOLD**           | No AI                                                                         |
| I-20      | **HOLD**           | No care-team writes in auth                                                   |

**No invariant weakened. Phase 2 RLS suite remains green.**

---

## 7. Deviations / notes

| Item                                            | Disposition                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth → database` dependency                    | **Allowed Phase 3 persistence requirement.** Forbidden pairs remain `auth → permissions`, `domain → @health-os/*`, `database → auth\|permissions`. Documented; boundaries PASS.                                                                                                                                                   |
| Migration 0012 `persons_select` allows `system` | Root cause: `INSERT … RETURNING` under FORCE RLS runs row visibility via SELECT policy; original policy only `is_self` or professional-with-grant, so system insert of new person failed (`42501` ExecWithCheckOptions). 0012 adds `system` branch for **identity shell only** (display_name, is_adult). Not a health-data grant. |
| Advisory lock in `runMigrations`                | Parallel vitest projects raced CREATE TYPE (`pg_type_typname_nsp_index`). Single advisory xact lock serializes runners.                                                                                                                                                                                                           |
| DB project `fileParallelism: false`             | Fixture DELETE/TRUNCATE raced auth INSERT FK. Serial DB tests only.                                                                                                                                                                                                                                                               |
| Unique `ipHint` + limiter `reset()` in tests    | Shared `unknown-ip` exhausted `registrationPerIp` across tests. Production behavior unchanged.                                                                                                                                                                                                                                    |
| Rate limiter in-memory                          | MVP; interface swap to Redis later.                                                                                                                                                                                                                                                                                               |
| Auth does not import `pg`                       | Re-exports `Pool`/`PoolClient`/`QueryResult` from `@health-os/database`.                                                                                                                                                                                                                                                          |
| apps/api HTTP                                   | Shell only; routes are Phase 4+/5; `httpListening: false` may still be true depending on shell — authReady flag set at package level.                                                                                                                                                                                             |

---

## 8. Out of scope (unchanged)

- Person/professional directory APIs, care team management UX
- Consent + policy engine (Phase 5)
- Clinical data APIs, documents, timeline, handoff
- AI
- OAuth/SSO/passkeys/Aadhaar
- Production deploy, TLS, Redis rate-limit store
- Real health data

---

## 9. Unresolved before Phase 4

1. **Git init + initial commit** (Phase 0 F-1) — still open.
2. First green GitHub Actions run with postgres service (unproven until push).
3. Explicit human authorization for **Phase 4**.

None require a contract/ADR amendment.

---

## Scorecard

```text
Identity schema + 0011/0012      PASS
Password scrypt (I-13)           PASS
Token hashing (I-13)             PASS
Enumeration resistance           PASS
Session lifecycle + fixation     PASS
CSRF + cookie defaults           PASS
Rate limits + lockout            PASS
Age gate 18+ (D6)                PASS
Invitation single-use + I-17     PASS
System principal under FORCE RLS PASS
RLS Phase 2 regression           PASS (28/28)
Auth integration                 PASS (21/21)
Architecture docs                PASS (IDENTITY-SECURITY, AUTHENTICATION-ARCHITECTURE)
Quality gates                    PASS (179/179, verify green)
Architecture violations          NONE
Phase 4                          NOT STARTED
STOP                             YES
```

---

## Next authorized phase

**Phase 4** — requires **separate explicit authorization** after this audit.

**Do not start Phase 4+ features without that authorization.**
