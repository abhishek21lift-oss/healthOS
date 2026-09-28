# RLS Model — PostgreSQL Row-Level Security

**Normative references:** ADR-0008, CONTRACT-v0.2 access formula, SECURITY-INVARIANTS I-1, I-3, I-4, I-9, I-10, I-20.

## Principles

1. **Default deny** — RLS enabled; no policy match ⇒ zero rows.
2. **Defense in depth** — app PEP (later phases) is semantic source; RLS catches omission bugs.
3. **Fail closed** — missing session context, unknown purpose, inactive membership/grant ⇒ deny.
4. **No org-as-ACL** — `organization_memberships` never appears in health-read `USING` clauses.
5. **Private notes are author-only** — structural class, not UI hiding (ADR-0005).

## Session variables

Set only inside a transaction by the trusted layer:

| GUC                  | Meaning                                                           |
| -------------------- | ----------------------------------------------------------------- |
| `app.principal_type` | `person` \| `professional` \| `system`                            |
| `app.principal_id`   | UUID of principal                                                 |
| `app.purpose`        | Declared purpose (`treatment`, `ai_assistance`, `break_glass`, …) |
| `app.request_id`     | Correlation id for audit                                          |

Helpers live in schema `authz`; context setters in `app_auth`.

## Policy matrix (health-bearing)

| Table                                                 | SELECT (sketch)                                                  | INSERT / UPDATE                                                                |
| ----------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `observations`                                        | `can_read_health(person, 'timeline_read', …)`                    | insert as professional with write path (grant optional for Phase 2 read tests) |
| `assessments`                                         | `can_read_health(…, 'assessment_read')`                          | insert/update requires professional + write category; update only author+draft |
| `goals` / `care_plans` / `interventions` / `outcomes` | matching `*_read` category                                       | not exercised in Phase 2 tests                                                 |
| `tasks`                                               | `timeline_read`                                                  | n/a                                                                            |
| `private_professional_notes`                          | author professional only                                         | insert/update author only; **no DELETE policy** (void only)                    |
| `consents` / `consent_revisions` / `access_grants`    | person + grantee (+ system)                                      | revisions: person-issued insert only; no update/delete                         |
| `handoffs` / `handoff_items`                          | person or sender/receiver professional                           | n/a Phase 2                                                                    |
| `care_teams`                                          | person self or active member                                     | n/a                                                                            |
| `care_team_memberships`                               | person self, the professional row, or system (**non-recursive**) | n/a                                                                            |
| `organization_memberships`                            | member self or system (**not a health predicate**)               | n/a                                                                            |
| `audit_logs`                                          | system or actor self                                             | insert with context; **no update/delete** (trigger + grants)                   |
| `person_access_logs`                                  | person self or system                                            | insert; immutability trigger                                                   |
| `break_glass_records`                                 | person, actor, or system                                         | n/a Phase 2 runtime                                                            |
| `outbox_events`                                       | system only                                                      | system only                                                                    |

## Proven negative tests (`packages/database/src/rls.test.ts`)

| #   | Scenario                              | Expected                                         |
| --- | ------------------------------------- | ------------------------------------------------ |
| 1   | `health_app` no context               | 0 rows on observations/assessments/private notes |
| 2   | Person A scans all observations       | only A’s rows                                    |
| 3   | Person A probes person B              | 0 rows                                           |
| 4   | Doctor + grant + `treatment`          | reads A’s rows                                   |
| 5   | Doctor + purpose `ai_assistance`      | 0 rows (purpose mismatch)                        |
| 6   | Nurse on care team **without** grant  | 0 rows (I-1)                                     |
| 7   | Org admin, no care team/grant         | 0 rows (I-3)                                     |
| 8   | Doctor probes person B                | 0 rows                                           |
| 9   | Revoke grant → next query             | 0 rows (I-9)                                     |
| 10  | End membership → next query           | 0 rows                                           |
| 11  | Doctor reads nurse’s private note     | 0 rows (I-4)                                     |
| 12  | Person reads private notes            | 0 rows                                           |
| 13  | `health_app` UPDATE/DELETE audit      | permission denied (I-10)                         |
| 14  | Superuser UPDATE/DELETE audit         | trigger `immutable` (I-10)                       |
| 15  | Second open care team for same person | unique index violation (I-20)                    |
| 16  | `health_app` role attributes          | not superuser, not BYPASSRLS, not owner          |

## Recursion rule

A table’s RLS policy must not `SELECT` the same table (Postgres raises infinite recursion).  
`care_team_memberships` policy is limited to self / row-professional / system. Cross-table checks (`can_read_health`) may read membership because they run while evaluating _other_ tables’ policies and only need the principal’s own membership row.

## Break-glass (schema only in Phase 2)

`break_glass_records` + purpose `break_glass` allow temporary elevated read for an active record with TTL. Full reason/notify/rate-cap product flow is later (I-14 / Phase 11); RLS already gates purpose to `break_glass`.

## What RLS does not replace

- Authentication and session issuance
- Application-layer audit emission for every health read
- Field-level redaction for exports/notifications
- Network/identity perimeter (`pg_hba`, TLS, secret rotation)
