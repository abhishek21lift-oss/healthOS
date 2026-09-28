# Timeline Projection — Phase 7

**Read model only** (ADR-0010). Canonical truth remains in clinical/document/handoff tables.

## Write-through path (ADR-0014)

```text
clinical mutation (same TX)
  → queueTimelineProjection(client, { personId, sourceType, sourceId })
  → outbox_events (event_type = 'timeline.project', status = 'pending')

later / on read
  → processTimelineOutbox(pool)     -- system: mark done, collect personIds
  → syncPersonTimeline(pool, personId)  -- system: upsert + orphan delete
```

Hooks exist on: observations create, assessment sign/amend, care transitions, document available.

## Collection rules

Implemented in `collectEntriesForPerson` (system context):

- **observations** — all rows for person.
- **assessments** — `status IN ('signed','amended')`; event type from status; `event_at = amended_at ?? signed_at ?? updated_at`; `predecessor_source_id` / `root_source_id` from `predecessor_assessment_id` (null on first generation).
- **goals** — map status → event; `event_at = created_at` if proposed else `updated_at`.
- **care_plans** — exclude `draft`.
- **interventions** — exclude `planned`.
- **outcomes** — all; title = summary truncated to 200 chars.
- **documents** — `status = 'available'` only.
- **handoffs** — `status IN ('sent','acknowledged','closed')`; event_at walks closed → acknowledged → sent → updated.

Never queries `private_professional_notes`.

## Upsert

```sql
INSERT INTO timeline_entries (…)
VALUES (…)
ON CONFLICT (person_id, source_type, source_id) DO UPDATE SET
  event_type, event_at, predecessor_source_id, root_source_id,
  display_title, display_status, projection_version
```

Requires system SELECT (0019) so conflict detection works under FORCE RLS.

## Rebuild vs sync

| Operation               | Behavior                                          | Use                      |
| ----------------------- | ------------------------------------------------- | ------------------------ |
| `rebuildPersonTimeline` | DELETE all for person → collect → insert          | Tests, full refresh, ops |
| `syncPersonTimeline`    | collect → delete orphans not in keep-set → upsert | Read-your-writes, outbox |
| `rebuildAllTimelines`   | per-person rebuild                                | Controlled full rebuild  |

Both run entirely inside `runInSystemContext` (single transaction). Safe to re-run; deterministic IDs guarantee parity.

## Projection version

`projection_version` defaults to 1 (`TIMELINE_PROJECTION_VERSION`). Bump only with a coordinated rebuild migration.

## Exclusions (proof)

- Draft assessments never collected.
- Unsigned assessments never collected.
- Private notes never collected (type + SQL + guard).
- Draft care plans / planned interventions never collected.
- Quarantined/failed/unavailable documents never collected.
- Handoffs still in `draft` never collected.
