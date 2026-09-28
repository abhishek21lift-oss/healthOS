# Timeline Security — Phase 7

**Invariant focus:** I-1 (dual gate), I-4 (private notes never in timeline), I-5 (structural exclusion), I-9 (revocation ≤5s), I-11 (cross-person deny), I-19 (purpose fail-closed).

## Read path (every list)

1. **Purpose fail-closed** — empty purpose throws before any DB work (I-19).
2. **PEP** — `authorizeClinical({ category: 'timeline_read', action: 'read' })` → Phase 5 `authorizeHealthAccess`.
3. **Projection refresh (optional)** — drain outbox + `syncPersonTimeline` under system (read-your-writes).
4. **RLS keyset query** — as requesting principal via `runClinicalAsPrincipal`.
5. **Audit** — PEP audits allow/deny (I-10 path).

Projection row presence is **never** sufficient. Revoked grants fail at step 2 even if rows remain (I-9).

## RLS matrix (`timeline_entries`)

| Principal                             | SELECT                                            | INSERT/UPDATE/DELETE |
| ------------------------------------- | ------------------------------------------------- | -------------------- |
| none / no context                     | 0 rows                                            | deny                 |
| person (self)                         | own rows only (`is_self`)                         | deny                 |
| person (other)                        | 0 rows                                            | deny                 |
| professional + active grant + consent | person’s rows if `can_read_health(timeline_read)` | deny                 |
| professional without grant            | 0 rows                                            | deny                 |
| system (trusted)                      | all rows (0019)                                   | allowed (0017)       |

Policies:

- `timeline_select`: `is_self OR can_read_health(…, 'timeline_read') OR principal_type = 'system'`
- `timeline_insert`: `WITH CHECK principal_type = 'system'`
- `timeline_update`: `USING/WITH CHECK principal_type = 'system'`
- `timeline_delete`: `USING principal_type = 'system'`

FORCE RLS on; `health_app` has no BYPASSRLS.

## Private notes (I-4 / I-5) — six layers

1. **Domain type** — `TimelineSourceType` has no `private_note`.
2. **DB CHECK** — `source_type` enum excludes private notes.
3. **Collector filter** — `collectEntriesForPerson` never queries `private_professional_notes`; 0018 grants system no SELECT on that table.
4. **Runtime guard** — `isPrivateNoteSourceType` throws if a private type ever appears.
5. **Integration proof** — projection tests assert body text absent and no private source types.
6. **Handoff** — `handoff_items.ref_kind` still excludes notes (Phase 6; unchanged).

## Source-table system read (0018)

System may SELECT observations, assessments, goals, care_plans, interventions, outcomes, documents, handoffs **for projection collection only**. Private notes intentionally excluded. Clients never receive system principal.

## Amend path (0020)

`assessments_update` allows author `status IN ('draft', 'signed')` so amend can set `signed → amended`. Content immutability remains enforced by:

- Domain `assertAssessmentContentFrozen` / `signAssessment`
- DB trigger `protect_signed_assessment` (blocks title/body change when signed/amended)

Phase 6 RLS test updated: doctor content edit on signed row now hits the **trigger** (`immutable`), not a silent 0-row RLS filter. Superuser path also hits the trigger. Security property (signed content immutable) preserved.

## Cursor (no PHI)

Opaque base64url JSON `{v,p,t,i,f}` + HMAC-SHA256. Secret: `TIMELINE_CURSOR_SECRET` else dev-only fallback. Bound to person + filter shape; wrong person/filter ⇒ decode failure ⇒ validation error. Payload has no clinical content.

## What Phase 7 does not claim

No HTTP route hardening, no TLS termination, no key management, no regulatory certification.
