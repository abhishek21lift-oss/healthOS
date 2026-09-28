# Phase 4 Audit — Collaboration Graph + Membership Lifecycle

**Scope:** organizations, memberships (+history), care teams, relationships, invitation Flow A/B, collaboration audit, Phase 4 RLS.  
**Out of scope:** consent UI/engine, AccessGrant compiler, health authorization engine, clinical APIs, AI, timeline, documents, handoff, messaging, public directory, billing, scheduling, OAuth/SSO, policy editor.

**Authorization:** Phase 4 explicitly authorized by the product owner after Phase 3 audit PASS.

---

## 1. Deliverables

| Deliverable                | Location                                                       | Status |
| -------------------------- | -------------------------------------------------------------- | ------ |
| Migration 0013 schema      | `packages/database/migrations/0013_collaboration_phase4.sql`   | DONE   |
| Migration 0014 RLS fixes   | `packages/database/migrations/0014_phase4_rls_fix.sql`         | DONE   |
| Domain state machines      | `packages/domain/src/collaboration.ts` (+ tests)               | DONE   |
| Service layer              | `apps/api/src/collaboration/*`                                 | DONE   |
| Integration tests          | `apps/api/src/collaboration/collaboration.integration.test.ts` | DONE   |
| Collaboration graph doc    | `docs/architecture/COLLABORATION-GRAPH.md`                     | DONE   |
| Collaboration security doc | `docs/security/COLLABORATION-SECURITY.md`                      | DONE   |
| This audit                 | `docs/architecture/PHASE-4-AUDIT.md`                           | DONE   |

## 2. Acceptance criteria

| #   | Criterion                                                                             | Result   |
| --- | ------------------------------------------------------------------------------------- | -------- |
| 1   | Four org roles only; membership `invited→active→ended`; history retained              | **PASS** |
| 2   | Cross-org isolation (app + RLS)                                                       | **PASS** |
| 3   | Care team one-open-per-person (I-20)                                                  | **PASS** |
| 4   | Flow A claim: relationship + care team; wrong recipient/expired/revoked/replay denied | **PASS** |
| 5   | Flow B claim: professional claimant; person cannot claim; revoke/reject deny claim    | **PASS** |
| 6   | Concurrent claim exactly one winner                                                   | **PASS** |
| 7   | No public directory (D6): unlinked person → 0 professionals                           | **PASS** |
| 8   | I-3: org role alone → 0 health rows                                                   | **PASS** |
| 9   | I-1: care team without AccessGrant → 0 health rows                                    | **PASS** |
| 10  | I-17: claim does not fork person                                                      | **PASS** |
| 11  | Collaboration audit append-only; no secrets/health in metadata                        | **PASS** |
| 12  | Client-supplied personId impersonation denied                                         | **PASS** |
| 13  | Phase 2 + Phase 3 regression green                                                    | **PASS** |

## 3. Security invariants — Phase 4 classification

| ID   | Invariant                        | Phase 4 status      | Evidence                                                          |
| ---- | -------------------------------- | ------------------- | ----------------------------------------------------------------- |
| I-1  | Health needs AccessGrant         | **PASS (negative)** | care-team-without-grant test = 0 rows                             |
| I-3  | Org role never authorizes health | **PASS**            | I-3 tests; `can_read_health` has no org refs                      |
| I-9  | Revoke ⇒ deny                    | **N/A health**      | membership end denies org ops via authz; health revoke remains P5 |
| I-11 | Cross-person ⇒ deny              | **PASS (collab)**   | impersonation + cross care-team tests                             |
| I-13 | Secrets hashed, never logged     | **PASS**            | token hash only; events forbid token keys                         |
| I-17 | No person fork on invite         | **PASS**            | person count stable across claim                                  |
| I-19 | Deny by default                  | **PASS**            | missing membership/admin → forbidden                              |
| I-20 | One open care team               | **PASS**            | unique index + conflict test                                      |

## 4. Quality gates

| Gate                                | Result              |
| ----------------------------------- | ------------------- |
| `pnpm format:check`                 | PASS                |
| `pnpm lint`                         | PASS                |
| `pnpm typecheck` / `typecheck:root` | PASS                |
| `pnpm boundaries`                   | PASS (0 violations) |
| `pnpm test` (all projects)          | PASS                |
| `pnpm build`                        | PASS                |
| `pnpm deps:audit`                   | PASS                |
| `pnpm verify`                       | PASS                |

## 5. RLS / isolation evidence

- Phase 2 RLS: 28/28
- Phase 3 auth integration: 21/21
- Phase 4 collaboration integration: 24/24
- Domain unit tests: included in suite
- Full database project run: **78/78** (all four database test files)

Cross-org, cross-person, invitation ownership, admin health denial, and ended-membership behavior covered in the collaboration integration suite and `packages/database/src/rls.test.ts` regression.

## 6. Architecture review

| Check                                                   | Result |
| ------------------------------------------------------- | ------ |
| Forbidden pairs unchanged                               | PASS   |
| Domain pure (no `@health-os/*` runtime deps)            | PASS   |
| Migration-only SQL under `packages/database/migrations` | PASS   |
| No health authorization from org membership             | PASS   |
| Actor only from Phase 3 session                         | PASS   |
| Contract/ADR frozen — no silent amendments              | PASS   |

## 7. Known gaps / next before Phase 5

1. Git init + first CI run still open (Phase 0 F-1).
2. HTTP route layer for collaboration not exposed (service layer only — by design until API phase).
3. Org admin roster listing under pure principal RLS is self-scoped; admin full-roster reads use system context (documented in COLLABORATION-GRAPH).
4. Rate limits remain in-memory until Phase 11.
5. Explicit human authorization required for **Phase 5** (consent + policy engine).

---

## Scorecard

```text
Migrations 0013/0014               PASS
Org + membership lifecycle         PASS
History append-only                PASS
Care team + relationships (I-20)   PASS
Invitation Flow A                  PASS
Invitation Flow B                  PASS
Claim concurrency                  PASS
Cross-org isolation                PASS
No public directory (D6)           PASS
I-3 org role ≠ health              PASS
I-1 no grant ⇒ deny                PASS
I-17 no person fork                PASS
RLS Phase 2 regression             PASS (28/28)
Phase 3 auth regression            PASS (21/21)
Phase 4 collaboration suite        PASS (24/24)
Database project total             PASS (78/78)
Architecture docs                  PASS (COLLABORATION-GRAPH, COLLABORATION-SECURITY)
Quality gates                      PASS (verify green)
Architecture violations            NONE
Phase 5                            NOT STARTED
STOP                               YES
```

---

## Next authorized phase

**Phase 5** — Consent + policy engine (central enforcement point). Requires **separate explicit authorization** after this audit.

**Do not start Phase 5+ features without that authorization.**
