# Security Invariants (Normative)

These invariants must never be violated. Phase 0 enforces only those that are structural (tooling/docs/defaults). Runtime enforcement lands in later phases as noted.

| ID   | Invariant                                                             | Phase 0 enforcement                                                                                  | Later runtime enforcement                                                                                             |
| ---- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| I-1  | No health read without principal ∧ membership ∧ AccessGrant ∧ purpose | N/A (no health APIs)                                                                                 | P4 **negative PASS**; P5 **PEP + RLS dual-gate PASS**; **P6 clinical dual-gate PASS**                                 |
| I-2  | Person is sole consent grantor/revoker                                | Documented; ADR-0006 locked                                                                          | **P5 PASS** (professional issue/revoke forbidden)                                                                     |
| I-3  | Organization role never authorizes health reads                       | Boundary: no org module yet; rule in contract                                                        | **P4 PASS**; **P5 PASS**; **P6 clinical regression PASS** (org never in ALLOW)                                        |
| I-4  | Private notes readable only by author                                 | Structure reserved; no feature code                                                                  | **P6 PASS** (author-only: PEP `PRIVATE_NOTE` + RLS author + service assert); compiler never emits `private_note_read` |
| I-5  | Private notes never in shared timeline or handoff manifests           | Documented; no timeline/handoff code                                                                 | **P6 structural PASS**; **P7 PASS** (collector never reads notes; type/CHECK/guard + integration proof)               |
| I-6  | AI only via approved AIContext; models have no DB access              | No AI code; package boundaries forbid domain→AI and web→database                                     | P9–10 broker + registry                                                                                               |
| I-7  | AI enters signed records only via human approve/sign                  | No AI code; ADR-0012/0013 frozen                                                                     | P9 tests                                                                                                              |
| I-8  | No autonomous AI health messages to persons                           | Registry design frozen; no side effects in Phase 0                                                   | P10                                                                                                                   |
| I-9  | Consent/membership revoke ⇒ deny ≤ 5s                                 | Documented                                                                                           | **P5 PASS** (sync grant revoke; measured ≤5s)                                                                         |
| I-10 | Audit immutable to app role; health access audited                    | Documented; no DB yet                                                                                | P2 RLS/privileges; P5 PEP audit inserts; **P6 clinical allow/deny audited**                                           |
| I-11 | Cross-person access ⇒ 404                                             | Documented                                                                                           | **P4 collab PASS**; P5 PERSON_MISMATCH; **P6 service+RLS deny / `not_found`**; **P7 timeline list deny / RLS 0 rows** |
| I-12 | Notifications never contain SHARED/HIGH bodies                        | Documented; no notification code                                                                     | P4+                                                                                                                   |
| I-13 | Secrets/tokens hashed, never logged                                   | **Yes:** no secrets in repo, .env.example only, lint rules, CI secret scan pattern                   | **P3 PASS:** scrypt + SHA-256 tokens; `assertNoSecrets`                                                               |
| I-14 | Break-glass reason+TTL+notify+rate cap; never AI                      | Documented                                                                                           | P11                                                                                                                   |
| I-15 | Person export excludes PROFESSIONAL_PRIVATE                           | Documented                                                                                           | P11 export filters                                                                                                    |
| I-16 | No SHARED/HIGH/PRIVATE payloads in logs                               | **Baseline:** logging policy in README + eslint no-restricted syntax guidance; redaction suite later | P11                                                                                                                   |
| I-17 | Invite consumption never forks existing person on contact match       | Documented                                                                                           | **P3+P4 PASS:** claim reuses person_id                                                                                |
| I-18 | AI requires purpose `ai_assistance` + category `ai_context`           | Documented in contract                                                                               | **P5 PEP deny PASS**; P9–10 end-to-end                                                                                |
| I-19 | Deny by default unknown task/category/purpose                         | Documented; future policy tests                                                                      | **P4+P5 PASS**; **P6 clinical purpose fail-closed PASS**                                                              |
| I-20 | One open care team per person                                         | **P2 unique constraint + P4 conflict test PASS**                                                     | P2 unique constraint                                                                                                  |

## Phase 0 security baseline (what we actually enforce now)

- No secrets committed; `.env.example` placeholder only.
- Node + pnpm pinned; lockfile committed; `pnpm install --frozen-lockfile` in CI.
- Strict TypeScript; no `any` escalation in lint.
- Dependency boundaries enforced by `pnpm boundaries` (dependency-cruiser) and architecture tests.
- Dependency audit script available (`pnpm audit` / `pnpm deps:audit`).
- No wildcard permissive CORS in any app default (no servers with CORS configured yet; rule recorded for API phase).
- No production secrets or provider keys present.

## What Phase 0 does NOT provide

- Runtime authorization
- Encryption key management
- RLS / database hardening
- Session security implementation
- Penetration testing
- Regulatory compliance validation

Production security requires Phases 2–11 plus external review.
