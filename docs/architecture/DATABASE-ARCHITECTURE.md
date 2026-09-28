# Database Architecture — Phase 2

**Status:** Implemented for Phase 2 audit  
**Contract:** `docs/architecture/CONTRACT-v0.2.md` (**FROZEN**)  
**ADR:** `docs/adr/0008-postgres-rls-defense-in-depth.md`

## Scope

Phase 2 delivers PostgreSQL schema, ordered SQL migrations, role separation, RLS policies, row↔domain mappers, and direct-SQL integration tests that prove the database rejects unauthorized health-data access.

**Not in Phase 2:** auth flows, HTTP/API routes, UI, AI, email, production deploy, real health data (fixtures are synthetic only).

## Roles

| Role           | Purpose                                     | Superuser | BYPASSRLS | Table owner |
| -------------- | ------------------------------------------- | --------- | --------- | ----------- |
| `postgres`     | Migrations / test fixture seed (tests only) | yes       | implicit  | n/a         |
| `health_owner` | Schema owner (ops/migrator target)          | no        | no        | yes         |
| `health_app`   | Application runtime                         | no        | no        | no          |

- `FORCE ROW LEVEL SECURITY` on health-bearing tables so even `health_owner` is subject to policies.
- `health_app` has no `DELETE` on history tables; no `UPDATE` on `consent_revisions`, `audit_logs`, `person_access_logs`.
- Immutability triggers block `UPDATE`/`DELETE` on audit and consent revision history (including superuser paths; DR uses `DISABLE TRIGGER` under break-glass procedure).

## Session context (trusted app layer only)

Transaction-local GUCs set exclusively by `app_auth.begin_request(principal_type, principal_id, purpose, request_id)`:

- `app.principal_type` ∈ `person` | `professional` | `system`
- `app.principal_id`
- `app.purpose`
- `app.request_id`

Missing/invalid context ⇒ helpers return `false` ⇒ **no rows** (fail closed).

Application code must use `runInPrincipalContext(pool, context, fn)` from `packages/database` — never hand raw SQL context setup to untrusted callers (Phase 5 PEP remains the semantic source; RLS is defense-in-depth).

## Access formula (mirrors contract)

For professional health reads (`authz.can_read_health`):

```text
context present
∧ principal = professional
∧ active CareTeamMembership (person, professional)
∧ active AccessGrant (category, purpose, window, status=active)
∨ active break_glass (purpose=break_glass only)
```

Person principals may read **only** their own person-scoped rows (`authz.is_self` / principal match).  
Org membership never appears in health-read predicates (I-3).

Private notes: author professional only (`authz.can_access_private_note`) — no org-admin, no care-team, no person path (I-4).

## Migrations

Ordered files under `packages/database/migrations/`:

| File                               | Contents                                                              |
| ---------------------------------- | --------------------------------------------------------------------- |
| `0001_roles.sql`                   | `health_owner`, `health_app` (NOBYPASSRLS)                            |
| `0002_identity.sql`                | persons, professionals, orgs, memberships, care teams, invitations    |
| `0003_consent_access.sql`          | consents, consent_revisions, access_requests, access_grants           |
| `0004_clinical.sql`                | observations, assessments, goals, care_plans, interventions, outcomes |
| `0005_collaboration_private.sql`   | handoffs, handoff_items, tasks, private_professional_notes            |
| `0006_audit_outbox.sql`            | audit_logs, person_access_logs, break_glass_records, outbox_events    |
| `0007_rls_functions.sql`           | `app_auth.*`, `authz.*` helpers                                       |
| `0008_rls_policies.sql`            | ENABLE + FORCE RLS + policies (default deny)                          |
| `0009_immutability_privileges.sql` | triggers + `health_app` grants                                        |
| `0010_ownership.sql`               | transfer tables/functions to `health_owner`                           |

Runner: `runMigrations(pool)` applies pending files inside one transaction and records `schema_migrations`.

## Package layout

```text
packages/database/
  migrations/*.sql
  src/pool.ts       # pools, beginRequest, runInPrincipalContext
  src/migrate.ts    # ordered SQL runner
  src/mappers.ts    # row → domain (Assessment, PrivateProfessionalNote, …)
  src/fixture.ts    # synthetic superuser seed
  src/rls.test.ts   # direct-SQL RLS integration tests
  src/index.test.ts # package smoke + mappers
```

Boundaries: may depend on `domain`, `validation`, `pg`. Must not import `auth` or `permissions` (dependency-cruiser).

## Test harness

- Container: `health-os-pg-test` (`postgres:16`), host port **5433**, db `health_os_test`.
- DSNs via `defaultTestDsn('postgres' | 'owner' | 'app')` / `HEALTH_OS_PG_*` env (CI service uses the same defaults).
- Vitest project `database` (180s timeouts); unit project excludes `packages/database`.
- Fixtures seeded as superuser (RLS bypass for setup only); assertions run as `health_app`.

## Environment variables

| Variable                          | Default               |
| --------------------------------- | --------------------- |
| `HEALTH_OS_PG_HOST`               | `127.0.0.1`           |
| `HEALTH_OS_PG_PORT`               | `5433`                |
| `HEALTH_OS_PG_DB`                 | `health_os_test`      |
| `HEALTH_OS_PG_SUPERUSER`          | `postgres`            |
| `HEALTH_OS_PG_SUPERUSER_PASSWORD` | `postgres_test_pw`    |
| `HEALTH_OS_PG_OWNER`              | `health_owner`        |
| `HEALTH_OS_PG_OWNER_PASSWORD`     | `health_owner_dev_pw` |
| `HEALTH_OS_PG_APP`                | `health_app`          |
| `HEALTH_OS_PG_APP_PASSWORD`       | `health_app_dev_pw`   |

Test-only credentials; not production secrets. Production secret management is a later phase.

## Explicitly out of scope

- HTTP routes, sessions, passwords, OAuth
- Full PEP (`packages/permissions`) compilation pipeline
- Timeline projection / outbox workers
- AI context broker
- Encryption at rest / KMS
- Production HA / backups
