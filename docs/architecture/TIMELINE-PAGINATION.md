# Timeline Pagination — Phase 7

## Keyset (not OFFSET)

Stable total order:

```sql
ORDER BY event_at DESC, timeline_entry_id DESC
```

`timeline_entry_id` is deterministic and unique ⇒ total order even when `event_at` ties.

## Cursor format

Opaque string (not a raw tuple):

```text
base64url( JSON { v: 1, p: personId, t: eventAtISO, i: entryId, f: filterShape } )
       + "." + base64url( HMAC-SHA256(payload, secret) )
```

- **Secret:** `process.env.TIMELINE_CURSOR_SECRET` or dev-only fallback (never log).
- **Binding:** person + filter shape (`eventTypes`, `sourceTypes`, `from`, `to`). Changing filters invalidates the cursor.
- **No PHI:** payload is identifiers/timestamps only.

## Decode failure

Any of: bad signature, wrong version, wrong person, wrong filter shape, malformed JSON ⇒ `ClinicalError('validation', 'Invalid cursor')`. Fail closed.

## Query shape

```sql
WHERE person_id = $1
  AND (event_type filters)
  AND (source_type filters)
  AND (event_at >= from / <= to)
  AND ( cursor: event_at < $t
        OR (event_at = $t AND timeline_entry_id < $i) )
ORDER BY event_at DESC, timeline_entry_id DESC
LIMIT $limit + 1
```

`hasMore` = fetched `limit + 1`. Next cursor encodes the last **returned** entry’s `(event_at, timeline_entry_id)`.

## Limits

`limit` clamped to `[1, 100]`, default 20.

## Why not OFFSET

- Deep pages skip/duplicate under concurrent writes.
- Keyset with deterministic ID keeps O(log n) index use via `idx_timeline_person_order`.
- Cursor is person-scoped ⇒ cannot be replayed across persons.
