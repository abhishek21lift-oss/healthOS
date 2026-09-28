# FOUNDATION RECOVERY REPORT

**Date:** 2026-09-25
**Scope:** Recover the accepted Phase 0–6 foundation so Phase 7 can be verified.
**Method:** Read-only forensic recovery. No source invented, no migrations fabricated, no gate weakened.

---

## Recovery Status

# NOT RECOVERABLE

The Phase 0–6 foundation (`packages/*/src`, `packages/*/package.json`, `packages/database/migrations/*.sql`, `tooling/*` source, root `tests/`) does not exist on this machine, on any attached volume, in any build artifact, in any backup, or in any authenticated remote repository.

> **Database foundation unrecoverable from available sources.**

Consequently **Phase 7 cannot be marked PASS.**

---

## 1. Evidence

Every reasonable local source was searched. Results:

| Source                                                   | Exists                      | Usable source                                                           | Migrations           | Tests                                 | Recoverable     |
| -------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------- | -------------------- | ------------------------------------- | --------------- |
| `/home/oem/Desktop/Health OS` (current)                  | yes                         | Phase 7 `apps/api/src` only                                             | **no**               | `apps/**/*.test.ts` only; no `tests/` | already present |
| `/media/oem/New Volume/Health OS` (backup, mtime 20:47)  | yes                         | **same gap**                                                            | **no**               | **same gap**                          | no              |
| `/media/oem/New Volume1`                                 | yes                         | no project copy                                                         | no                   | no                                    | no              |
| `/media/oem/New Volume2`                                 | yes                         | `health-app*` = unrelated Express app                                   | unrelated            | no                                    | no              |
| `/mnt`                                                   | empty                       | —                                                                       | —                    | —                                     | no              |
| `/tmp`                                                   | yes                         | turbo `dist/` only (294 files)                                          | **no**               | no                                    | dist only       |
| `.turbo/cache` (762 manifests)                           | yes                         | `dist/` output only                                                     | **0 `.sql` entries** | no                                    | dist only       |
| Source maps (66 across `apps/*/dist`)                    | yes                         | `sourcesContent` present in **0 of 66**                                 | —                    | —                                     | no              |
| Git `.git` / worktrees / bundles                         | **absent for this project** | —                                                                       | —                    | —                                     | no              |
| GitHub (`gh` authenticated, 69 repos)                    | yes                         | no matching repository                                                  | no                   | no                                    | no              |
| GitHub code search                                       | yes                         | no match                                                                | —                    | —                                     | no              |
| pnpm store (`~/.local/share/pnpm/store/v11`)             | yes                         | external deps only                                                      | no                   | no                                    | no              |
| Trash (`~/.local/share/Trash`)                           | **directory absent**        | —                                                                       | —                    | —                                     | no              |
| Archives (`*.zip`, `*.tar*`, `*.7z`)                     | yes                         | 3 unrelated downloads                                                   | no                   | no                                    | no              |
| IDE/editor history (VS Code, Cursor, JetBrains, Sublime) | **all absent**              | —                                                                       | —                    | —                                     | no              |
| Shell history (`~/.bash_history`, 68 lines)              | yes                         | system setup only; no project commands                                  | no                   | no                                    | no              |
| OpenCode artifacts (`repos/`, `shell/`)                  | yes                         | `repos/` empty; 2× 0-byte dirs                                          | no                   | no                                    | no              |
| `.sql` files across `/home /media /mnt /opt /srv /var`   | 370 files                   | **0 are Health OS** (all `evolution-api`, `619-erp`, `flutter`, `jedi`) | **no**               | —                                     | no              |

### Decisive negative searches

- `find` for `CONTRACT-v0.2.md` across `/` → **1 hit** (current workspace only).
- `find` for `DOMAIN-KERNEL.md` → **2 hits** (current + backup, both gap-identical).
- `find` for `pnpm-workspace.yaml` → 4 hits; only 2 are this project, both missing `packages/`.
- `grep -l DOMAIN_CONTRACT_VERSION` across `/` → only turbo `dist/`, the two project copies, and their docs.
- `grep -l 'can_read_health|assertAssessmentContentFrozen'` → only turbo `dist/*.d.ts` and the two copies' `apps/api` tests.
- `find` for `0017_*.sql`, `timeline.ts` (outside `dist`/`node_modules`) → **0 hits**.
- `find` for `.sql` under `/media /mnt /home /opt /srv /var` → **0 Health OS migrations**.

**Conclusion:** exactly two copies of this project exist on the machine, and both contain the _same_ damage. The foundation was lost before either copy was made.

---

## 2. Git

| Check                                                                     | Result                                                                                                                                                         |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.git` in `/home/oem/Desktop/Health OS`                                   | **absent**                                                                                                                                                     |
| `.git` anywhere for this project                                          | **absent**                                                                                                                                                     |
| Repos above/below workspace                                               | `/home/oem/OpenCut`, `/home/oem/evolution-api`, `/home/oem/.nvm` — all unrelated                                                                               |
| Git remotes ever configured                                               | none (no `.git` ⇒ no remote metadata survives)                                                                                                                 |
| `gh` CLI authentication                                                   | **authenticated** as `abhishek21lift-oss`, scopes `gist, read:org, repo, workflow`                                                                             |
| Repositories in account                                                   | **69** — none is this project                                                                                                                                  |
| Nearest name match                                                        | `abhishek21lift-oss/health-619-backend` — **rejected**: plain Express app, `src/` + `package.json`, no `packages/`, no `migrations/`, last pushed `2026-04-29` |
| Remote branches / tags / commits / PRs for this project                   | **none exist**                                                                                                                                                 |
| Code search `CONTRACT-v0.2`, `TIMELINE_CURSOR_SECRET`, `timeline_entries` | no repository containing this project                                                                                                                          |
| Git bundles / patches                                                     | 2 bundles, both `mps-ai` (unrelated)                                                                                                                           |

**No repository was found, therefore nothing was cloned and nothing was overwritten.** Section 7 of the recovery procedure was not triggered.

---

## 3. Recovered Files

Classification is deliberately strict.

### EXACTLY RECOVERED

- **294 compiled files** under `/tmp/turbo_chron/packages/*/{dist}` — `.js`, `.d.ts`, `.js.map` for `domain` (70), `auth` (46), `database` (22), `permissions` (6), `validation` (6), `ui` (6).
- Compiled `apps/*/dist` output present in the workspace.

This is **transpiled output**, not source. It is admissible as _evidence of what existed_, never as a substitute for source.

### INFERRED (evidence only, not recovered)

- That 6 workspace packages existed and built: turbo manifests record **2001 `packages/*` output entries** (`domain` 730, `auth` 598, `database` 445, `permissions` 109, `validation` 91, `ui` 28).
- Exported API surface of each package, read from `.d.ts` (e.g. `@health-os/domain` exported `TIMELINE_SOURCE_TYPES`, `isPrivateNoteSourceType`).
- Package boundaries implied by `pnpm-workspace.yaml` (`apps/*`, `packages/*`, `tooling/*`).

### RECONSTRUCTED

- **Nothing.** No file was written to `packages/`, `tooling/`, or `tests/`.

### Why build artifacts cannot close the gap

- Source maps: **0 of 66** contain `sourcesContent` — no original TypeScript is embedded.
- Turbo manifests: **0 entries** ending `.sql`, **0 entries** containing `/src/` across all 762 manifests.
- Recovered `packages/database/dist/migrate.js` is the _runner_: it does `readdirSync('../migrations')` and `readFileSync` each `.sql` at runtime. The directory it reads does not exist, and its contents were never a build output — so migrations were never cacheable and are **not recoverable from turbo**.

---

## 4. Missing Files (still missing, exact paths)

```
packages/domain/src/
packages/database/src/
packages/database/migrations/          ← 0001–0020, all RLS policies
packages/auth/src/
packages/permissions/src/
packages/validation/src/
packages/ui/src/
packages/*/package.json                ← all 6 workspace manifests
tooling/tsconfig/node.json             ← extends target of all 3 apps
tooling/eslint-config/src/             ← shared ESLint config source
tests/                                 ← architecture/boundary suites
.git/                                  ← no history at all
```

`packages/` and `tooling/` directories exist but contain **only `node_modules`**.

---

## 5. Database

**Migration recovery status: NOT RECOVERABLE.**

- Migrations expected: `0001` … `0020` (Phase 2 RLS, Phase 3 identity, Phase 4 collaboration, Phase 5 authorization, Phase 6 clinical, Phase 7 `0017`–`0020`).
- Found: **zero**. 370 `.sql` files exist machine-wide; none belong to this project.
- No migration was recreated. Per instruction: _"Do not recreate migrations merely because you know what the architecture should contain."_

Without migrations there is no schema, therefore no direct-SQL RLS test, FORCE RLS test, default-deny test, or cross-person isolation test can be constructed — even if a database were available.

---

## 6. PostgreSQL

| Check                         | Result                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| `which psql`                  | **MISSING**                                                                                             |
| `which postgres`              | **MISSING**                                                                                             |
| `which initdb`                | **MISSING**                                                                                             |
| `which pg_ctl` / `pg_isready` | **MISSING**                                                                                             |
| `docker --version`            | **MISSING** (no docker, no podman)                                                                      |
| `sudo` rights                 | user `oem` has `(ALL : ALL) ALL`, but `sudo` **requires a password** (not supplied, will not be sought) |
| `apt-cache policy postgresql` | candidate `16+257build1.1`, `Installed: (none)`                                                         |
| Rootless alternative          | `embedded-postgres` reachable on npm (`18.4.0-beta.17`)                                                 |

**Can PostgreSQL be installed with available permissions?** Yes — either by the user running `sudo apt install postgresql` with their own password, or rootlessly via the `embedded-postgres` npm package.

**It was not installed.** Per §9, the system was not silently altered. It would in any case be moot: with migrations unrecoverable there is no schema to apply.

No production database was contacted or used.

---

## 7. Phase 0–6 Integrity

Verification requires the source. The source is absent, so no phase can be confirmed.

| Phase                                                                                                                                               | Expected artifacts                                                                           | Status                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Phase 0** — CI, quality gates, dependency audit                                                                                                   | `.github/workflows/ci.yml`, root scripts                                                     | **FAIL (unverifiable)** — scripts exist and were executed; gates do not pass (§8) |
| **Phase 1** — domain kernel, state machines, errors, opaque IDs, access taxonomy                                                                    | `packages/domain/src`                                                                        | **FAIL (unverifiable)** — absent                                                  |
| **Phase 2** — migrations, roles, FORCE RLS, default deny, `health_app` restrictions, direct SQL tests                                               | `packages/database/migrations`, `tests/`                                                     | **FAIL (unverifiable)** — absent                                                  |
| **Phase 3** — identity, auth, sessions, verification, rate limiting, CSRF, invitation tokens                                                        | `packages/auth/src`                                                                          | **FAIL (unverifiable)** — absent                                                  |
| **Phase 4** — organizations, memberships, care teams, invitations, collaboration isolation                                                          | `apps/api/src/collaboration` present; depends on absent packages                             | **FAIL (unverifiable)**                                                           |
| **Phase 5** — consent, policy, AccessGrant compiler, PEP, evaluator, revocation, AccessRequest                                                      | `apps/api/src/{consent,authorization}` present; depends on `@health-os/permissions` (absent) | **FAIL (unverifiable)**                                                           |
| **Phase 6** — observations, assessments, signing/amendment, goals, care plans, interventions, outcomes, private notes, documents, document security | `apps/api/src/clinical` present; depends on absent packages                                  | **FAIL (unverifiable)**                                                           |

**Recovery is NOT declared complete.** The source cannot be shown consistent with the accepted architecture, because it cannot be shown to exist.

---

## 8. Quality Gates

Authoritative run of the repository's canonical scripts (from `package.json`), all executed, none substituted.

| #   | Gate             | Command               | Exit | Result   | Evidence                                                                                                      |
| --- | ---------------- | --------------------- | ---- | -------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | format           | `pnpm format:check`   | 0    | **PASS** | `All matched files use Prettier code style!`                                                                  |
| 2   | lint             | `pnpm lint`           | 1    | **FAIL** | `1801 problems` (0 warnings) across 35 of 45 files                                                            |
| 3   | typecheck        | `pnpm typecheck`      | 2    | **FAIL** | `TS5083: Cannot read file '.../tooling/tsconfig/node.json'`; `TS2307: Cannot find module '@health-os/domain'` |
| 4   | typecheck:root   | `pnpm typecheck:root` | 2    | **FAIL** | 289 errors (`TS2307`/`TS2347`/`TS7006`)                                                                       |
| 5   | test             | `pnpm test`           | 1    | **FAIL** | `Test Files 11 failed (11)` · `Tests no tests`                                                                |
| 6   | boundaries       | `pnpm boundaries`     | 1    | **FAIL** | `ERROR: Can't open 'tests' for reading. Does it exist?`                                                       |
| 7   | build            | `pnpm build`          | 2    | **FAIL** | `Tasks: 0 successful, 3 total`                                                                                |
| 8   | dependency audit | `pnpm deps:audit`     | 0    | **PASS** | `No known vulnerabilities found`                                                                              |
| 9   | aggregate        | `pnpm verify`         | 1    | **FAIL** | aborts at lint                                                                                                |

**2 of 9 gates pass. Root cause of every failure is the missing foundation, not a defect in Phase 7 code.**

Test failure detail (all 11 files fail during transform, before any assertion runs):

```
TSConfckParseError: failed to resolve "extends":"../../tooling/tsconfig/node.json"
  in apps/api/tsconfig.json  (and apps/web, apps/worker)
```

Failing files: `apps/{api,web,worker}/src/main.test.ts`, plus 8 integration suites —
`authorization`, `clinical-rls`, `clinical`, `documents`, `private-notes`, `collaboration`, `consent`, `timeline`.

Note: the `architecture` vitest project contributes **0 files** (its directory is missing) — so boundary coverage is silently absent from `pnpm test` as well as failing `pnpm boundaries`.

### Phase 2–6 security/integration suites

Cannot be run — same transform failure, plus no database and no migrations. **No Phase 2–6 suite has been executed.**

---

## 9. Phase 7

### Existing implementation status

Present and structurally complete at `apps/api/src/timeline/` — **1487 lines / 7 files**:

```
    9  index.ts
   91  cursor.ts
   92  outbox.ts
  118  types.ts
  173  query.ts
  369  project.ts
  635  timeline.integration.test.ts
 1487  total
```

Docs present: `TIMELINE-{ARCHITECTURE,SECURITY,PROJECTION,PAGINATION}.md`, `PHASE-7-AUDIT.md`.

Docs and source are **byte-identical** to the 20:47 backup — no drift introduced.

### Do not trust `PHASE-7-AUDIT.md`

It claims:

| Claim                                                       | Current reality                 |
| ----------------------------------------------------------- | ------------------------------- |
| `Overall result: PASS`                                      | **not reproducible**            |
| migrations `0017`–`0020` at `packages/database/migrations/` | **files do not exist**          |
| `pnpm lint` PASS                                            | **1801 errors**                 |
| `pnpm test` PASS (35 files / 371 tests)                     | **11 failed, 0 tests executed** |
| `pnpm typecheck`/`build`/`boundaries`/`verify` PASS         | **all FAIL**                    |
| "Timeline (Phase 7) PASS (12/12)"                           | **not executable**              |
| `PHASE 7 COMPLETE — READY FOR PHASE 8 AUTHORIZATION`        | **withdrawn pending evidence**  |

I could not confirm or refute those historical claims: they may have been true at 20:17 while the foundation existed, but **no evidence of that run survives**, and §19 forbids marking an invariant PASS without a reproducible test or accepted proof. The claims are therefore **unverified**, not "retracted as false".

### Static findings (code reading only — NOT runtime-verified)

These are inspection results. None is confirmed by execution.

**F-1 — HIGH — outbox marks events `done` before projection succeeds**
`apps/api/src/timeline/outbox.ts:68-74` sets `status = 'done', attempts = attempts + 1` _inside_ the system transaction; `syncPersonTimeline` only runs afterwards at `:78-80`. If sync throws, the rows are already `done` and will never be retried.
The function's own doc comment (`outbox.ts:48`) claims _"failures leave row pending for retry (at-least-once)"_ — **contradicted by the code**. `TIMELINE-ARCHITECTURE.md` and `TIMELINE-PROJECTION.md` likewise promise at-least-once.
Answer to the §10 question: **yes — a projection failure can permanently lose an event.** Partial mitigation exists (reads re-sync when `sync !== false`), but that path swallows errors and does not apply when `sync: false`.
→ Requires a transactional fix + failure/retry tests. **Blocked** (cannot build or run tests).

**F-2 — HIGH — cursor secret fails open to a hardcoded constant**
`cursor.ts:18-24` falls back to `Buffer.from('timeline-cursor-dev-only-secret')` when `TIMELINE_CURSOR_SECRET` is unset or empty. `TimelineDeps` (`types.ts:18`) does **not** declare `cursorSecret`, so `query.ts:106` and `:168` reach it via `(deps as { cursorSecret?: Buffer }).cursorSecret` — verified by probe to compile, but it is an escape hatch around the type. Repo-wide grep shows **no producer anywhere**, and the variable is **absent from `.env.example`**.
Answer to the §10 question: **yes — production can silently use a development fallback key.** Must fail closed in production.
Note: the cursor is defence-in-depth only (person scope + PEP + RLS are the real boundary, per `TIMELINE-SECURITY.md`), so this is not a direct authorization bypass — but it violates fail-closed and §14's "resistant to tampering".
→ Fix + tests. **Blocked.**

**F-3 — MEDIUM — `rootSourceId` is the immediate predecessor, not the root**
`project.ts:121` sets `rootSourceId: row.predecessor_assessment_id`. `assessments` exposes only `predecessor_assessment_id` (`clinical/assessments.ts:43`) — **no root column exists**.
Chain `A→B`: `B.root = A` ✅ correct. Chain `A→B→C`: `C.root = B` ❌ should be `A`.
`TIMELINE-PROJECTION.md:24` documents this behaviour, but §10 requires lineage/root linkage to resolve correctly across current semantics. The integration test exercises only one generation (`timeline.integration.test.ts:259-264`).
→ Requires schema/semantics decision + multi-level regression test. **Blocked.**

**F-4 — MEDIUM — projection failures are silently swallowed**
`query.ts:97-100` is a bare `catch {}` with no logging or metric. §8 requires projection failures to be observable; §15 requires no false success. This is precisely non-observable.
→ **Blocked.**

**F-5 — MEDIUM — per-read full re-projection with no measurement**
`query.ts:95-96` drains the **global** outbox (up to 500 rows, any person) and then fully re-projects the requested person on **every** read: ~8 source SELECTs + one statement per row + one orphan SELECT + one DELETE per orphan, all in a transaction. Also a cross-tenant work-amplification concern.
§20 requires _measured_ targets with baseline vs post-change comparison. **No measurement artifact exists in the repository.**
→ Measure first, then smallest correct fix. **Blocked** (no database).

**F-6 — LOW — cursor payload fields unvalidated**
`cursor.ts:84-90` accepts any string for `t` and `i`; `query.ts:147-148` does `new Date(...)` and passes `entryId` as `$7::uuid`. Combined with F-2's known key, a forged cursor could yield an internal error instead of `ClinicalError('validation','Invalid cursor')`, contradicting `TIMELINE-PAGINATION.md:28` ("fail closed"). → **Blocked.**

**F-7 — INFO — private-note guard needs a cast**
`project.ts:309` compares against `('private_note' as TimelineSourceType)`. Correct as a belt-and-braces runtime check; the real structural guarantees are the collector queries and the domain type.

### What static inspection _does_ support

- Projection is read-only: no path writes canonical clinical tables from the timeline module.
- Deterministic identity: `timelineEntryId` is a SHA-256-derived UUIDv5-style value (`types.ts:81-94`), giving idempotent upsert and rebuild parity.
- Collectors never reference `private_professional_notes` (grep: 0 hits in `apps/api/src/timeline/`).
- Purpose check precedes all DB work (`query.ts:75-77`).
- Read flow is `authorizeClinical` → `runClinicalAsPrincipal` (`query.ts:80`, `:116`) — PEP then RLS as principal.
- No PHI in cursor payload or outbox payload (ids/timestamps only).

These are **observations**, not proofs. Per §19 none is marked PASS.

### Security findings

No _runtime_ security verification was performed — impossible without foundation and database. The security-relevant static findings are **F-1, F-2, F-6** above. No security control was deleted, weakened, or disabled.

### Fixes performed

**None.** Fixing Phase 7 before the foundation is restored would produce code that cannot be compiled, linted, typechecked, or tested — an unverifiable change to a system whose security foundation is already unverifiable. Per §10, Phase 7 re-audit happens _only after_ foundation recovery.

### Remaining blockers

1. `packages/*/{src,package.json}` — absent, unrecoverable.
2. `packages/database/migrations/*.sql` (0001–0020) — absent, unrecoverable.
3. `tooling/tsconfig/node.json` + `tooling/eslint-config` — absent, unrecoverable.
4. `tests/` — absent, unrecoverable.
5. Git history / remote — never existed.
6. PostgreSQL — not installed (installable, but moot without #2).
7. F-1 … F-6 — undiagnosable at runtime until #1–#6 are resolved.

---

## 10. Security Invariants

No invariant is marked PASS. §19 forbids it without a reproducible test or accepted proof, and neither exists.

| Invariant                            | Status           | Why                                                                                    |
| ------------------------------------ | ---------------- | -------------------------------------------------------------------------------------- |
| I-1 dual gate (PEP + RLS)            | **NOT VERIFIED** | PEP path present statically; `@health-os/permissions` absent, no executable test       |
| I-4 private notes never in timeline  | **NOT VERIFIED** | static support (collector grep, domain type); DB CHECK + integration proof unavailable |
| I-5 structural exclusion / validator | **NOT VERIFIED** | same                                                                                   |
| I-9 revocation ≤ 5s                  | **NOT VERIFIED** | requires live database                                                                 |
| I-10 audit of allow/deny             | **NOT VERIFIED** | requires live database                                                                 |
| I-11 cross-person deny               | **NOT VERIFIED** | requires live database + RLS                                                           |
| I-16 no PHI in cursor/outbox/logs    | **NOT VERIFIED** | statically consistent, no test executed                                                |
| I-19 purpose fail-closed             | **NOT VERIFIED** | code path present, no test executed                                                    |
| I-20 care-team constraint            | **NOT VERIFIED** | requires live database                                                                 |
| FORCE RLS / default deny             | **NOT VERIFIED** | migrations absent — cannot be established at all                                       |
| Direct SQL RLS proof                 | **NOT VERIFIED** | no migrations, no database                                                             |

**No fake or mocked substitute was created for any required RLS proof.**

---

## 11. Quality Gates — prohibited construct scan

Statically verifiable and **PASS**:

| Construct                               | Count in `apps/` |
| --------------------------------------- | ---------------- |
| `as any`                                | **0**            |
| `@ts-ignore`                            | **0**            |
| `@ts-expect-error`                      | **0**            |
| `eslint-disable`                        | **0**            |
| `.skip(` / `.only(` / `.todo(` in tests | **0**            |
| `continue-on-error` in `.github/`       | **0**            |
| `--no-verify` / `--force` used          | **no**           |

`--force` and `--no-verify` were not used at any point. No lint/typecheck/test was disabled. No failing test was deleted. No gate was downgraded.

_(One non-prohibited observation: `query.ts:106,168` uses `as { cursorSecret?: Buffer }` to read a field absent from `TimelineDeps` — reported as F-2.)_

---

## 12. Architecture Drift

**NONE.**

| Check                                     | Result                                                                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Frozen contract modified                  | **no** — `CONTRACT-v0.2.md` byte-identical to 20:47 backup                                                              |
| `DOMAIN-KERNEL.md` modified               | **no** — byte-identical                                                                                                 |
| Phase 8 handoff/referral implemented      | **no** — only Phase 7 handoff _event kinds_ (`handoff_sent/acknowledged/closed`), which are in-scope projection sources |
| AI runtime introduced                     | **no**                                                                                                                  |
| Redis/Kafka/microservices introduced      | **no** — `apps/worker/src/main.ts:3` still reads "no queue, no Redis, no outbox drain, no AI jobs"                      |
| New authorization model                   | **no** — read path still uses Phase 5 PEP                                                                               |
| Existing security controls weakened       | **no** — nothing deleted or disabled                                                                                    |
| `DOMAIN_CONTRACT_VERSION` changed         | **no**                                                                                                                  |
| Current workspace altered during recovery | **no** — investigation was read-only; `/tmp/turbo_chron` was created as scratch                                         |

---

## 13. Final State

# FOUNDATION RECOVERY BLOCKED — DO NOT PROCEED TO PHASE 8

**Recovery Status: NOT RECOVERABLE.**

- **Database foundation unrecoverable from available sources.**
- Phase 0–6 foundation: **FAIL (unverifiable)** for every phase.
- Quality gates: **2 of 9 PASS** (`format`, `deps:audit`); **7 FAIL**.
- Phase 7: implementation present, **not verified**; prior PASS claim **not reproducible**.
- Security invariants: **none PASS**.
- Architecture drift: **NONE**.
- Phase 8: **not started**.

### What it would take to unblock

1. **Obtain the authentic Phase 0–6 source** from wherever it actually lives (the original author's machine, an unlisted/private remote, or an archive) — specifically `packages/*/src`, `packages/*/package.json`, `packages/database/migrations/*.sql`, `tooling/`, `tests/`.
2. **Install PostgreSQL** — user runs `sudo apt install postgresql` with their password, or approves the rootless `embedded-postgres` route.
3. **Restore version control** (`git init` + first commit) _before_ any further change, so this loss cannot recur silently.
4. Then: `pnpm install --frozen-lockfile` → migrations → full §22 gate suite → Phase 2–6 regression → direct SQL/RLS proof → Phase 7 re-audit including F-1 (outbox), F-2 (cursor secret), F-3 (amendment root), F-4 (observability), F-5 (measure then fix).

Nothing in Phase 7 should be marked PASS, and Phase 8 must not begin, until steps 1–4 are complete.
