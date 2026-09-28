# Clinical Data Security — Phase 6

**Normative references:** CONTRACT-v0.2, ADR-0005, ADR-0006, ADR-0007, ADR-0008, SECURITY-INVARIANTS I-1…I-5, I-9…I-11, I-16, I-18…I-20.

## Clinical data classes

| Data class             | Examples                                                                           | Who can read                                                          |
| ---------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `SHARED_HEALTH`        | observations, signed assessments, goals, care plans, outcomes, documents (default) | Person self + granted professionals (category × purpose × grant)      |
| `PROFESSIONAL_PRIVATE` | private professional notes                                                         | Author professional only                                              |
| `HIGH_SENSITIVITY`     | documents flagged HIGH_SENSITIVITY                                                 | Same as SHARED_HEALTH, but download server-mediated only (no key/URL) |
| Draft assessments      | status = `draft`                                                                   | Authoring professional only; person excluded                          |

Person self path: person principal with matching `personId` may read own non-private categories without an AccessGrant. Cross-person id ⇒ deny.

## Dual-gate model (I-1)

Every clinical operation:

1. **Application PEP** — `authorizeClinical` → `authorizeHealthAccess` (Phase 5). Validates principal, relationship, membership, consent, AccessGrant, purpose, category, action, ABAC. Audits allow/deny.
2. **PostgreSQL RLS** — independent second gate under `runInPrincipalContext`. If app check is omitted or buggy, DB still denies.

**App ALLOW + DB DENY ⇒ DENY.** No RLS bypass. No treat-app-allow-as-sufficient.

```text
Request
  → requirePurpose (fail closed if empty)
  → authorizeHealthAccess (PEP)
  → runClinicalAsPrincipal (RLS)
  → health rows
```

## Purpose requirement (I-19)

- Purpose validated at **input boundary** before any DB call.
- Empty / missing purpose → `PURPOSE_REQUIRED`.
- Purpose not in active consent scope → `PURPOSE_NOT_CONSENTED`.
- Unknown purpose string → `UNKNOWN_PURPOSE`.
- Fail closed: never default to a permissive purpose.

## Category isolation

- No generic `health_data` category. Each resource maps to frozen categories (see CLINICAL-CORE.md).
- Reads ≠ writes: `assessment_read` never grants `assessment_write`; `document_read` is required for document create/update (only document category).
- `sign` is a distinct action requiring `assessment_write`.
- `ai_context` category + `ai_assistance` purpose required for any AI path (I-18); Phase 6 has no AI runtime — deny path exists and is tested.

## Cross-person access (I-11)

- PEP: actor `personId` ≠ target `personId` → `PERSON_MISMATCH` (service maps to `not_found` where existence must not leak).
- RLS: `person_id = authz.current_person_id()` — 0 rows for mismatched person.
- No existence oracle: private notes, drafts, other-person resources all return `not_found` (not `forbidden`).

## Audit (I-10)

- PEP writes allow/deny to `audit_logs` (and `person_access_logs` on allow) — Phase 5 behavior, unchanged.
- Clinical mutations insert audit events in the same transaction where applicable.
- Private-note promotion audits **without** note body.
- Audit rows are immutable to app role (Phase 2 privileges).

## No PHI in logs (I-16)

- Clinical services log no observation values, assessment bodies, note bodies, document bytes, or checksums in application logs.
- `ClinicalError` external messages are generic (`Not found`, `Access denied`); detailed deny reason stays in structured error / audit, not `console`.
- Error causes for unexpected failures are not stringified with row payloads.

## Private note security

See `docs/architecture/PRIVATE-NOTES.md`. Summary: author-only via PEP `PRIVATE_NOTE` + RLS author check + service author assert; never ordinary-granted; never in timeline/handoff/AI.

## Document security

See `docs/architecture/DOCUMENT-SECURITY.md`. Summary: lifecycle + scan gate, quarantine terminal, no DELETE, HIGH server-mediated, sha256 integrity, `document_read` category.

## Fail-closed defaults (I-19)

| Condition                    | Result                |
| ---------------------------- | --------------------- |
| No authenticated principal   | deny                  |
| Empty purpose                | `PURPOSE_REQUIRED`    |
| Unknown category             | `UNKNOWN_CATEGORY`    |
| Unknown purpose              | `UNKNOWN_PURPOSE`     |
| No relationship              | deny                  |
| Membership ended             | deny                  |
| Consent revoked / expired    | deny                  |
| No effective grant           | deny                  |
| Org role as health predicate | never consulted (I-3) |

## Evidence

- `apps/api/src/clinical/*.integration.test.ts` — full dual-gate matrix
- `apps/api/src/clinical/clinical-rls.integration.test.ts` — RLS independent deny
- `apps/api/src/authorization/authorization.integration.test.ts` — Phase 5 PEP regression
- `packages/database/src/rls.test.ts` — Phase 2 RLS baseline
- `docs/architecture/PHASE-6-AUDIT.md` — gate results and invariant table
