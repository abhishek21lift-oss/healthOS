/**
 * Transactional outbox helpers for timeline projection (ADR-0014).
 * Payload carries ids only — no PHI bodies (I-16).
 * At-least-once: project is idempotent via deterministic timeline_entry_id.
 */
import { runInSystemContext, withClient, type Pool, type PoolClient } from '@health-os/database';

import { syncPersonTimeline } from './project.js';
import type { TimelineSourceType } from './types.js';

export const TIMELINE_OUTBOX_EVENT_TYPE = 'timeline.project';
export const TIMELINE_AGGREGATE_TYPE = 'timeline_projection';

export async function queueTimelineProjection(
  client: PoolClient,
  input: {
    readonly personId: string;
    readonly sourceType: TimelineSourceType;
    readonly sourceId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, person_id, payload)
     VALUES ($1, $2, $3::uuid, $4::uuid, $5::jsonb)`,
    [
      TIMELINE_OUTBOX_EVENT_TYPE,
      TIMELINE_AGGREGATE_TYPE,
      input.sourceId,
      input.personId,
      JSON.stringify({
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        personId: input.personId,
      }),
    ],
  );
}

interface PendingRow {
  outbox_id: string;
  person_id: string | null;
  payload: { sourceType?: string; sourceId?: string; personId?: string };
}

/**
 * Drain pending timeline outbox events (system context), then idempotently
 * sync each touched person's projection from canonical sources.
 * Marks done; failures leave row pending for retry (at-least-once).
 * Returns number of distinct person ids refreshed.
 */
export async function processTimelineOutbox(pool: Pool): Promise<number> {
  const { personIds, outboxIds } = await runInSystemContext(pool, 'treatment', async (client) => {
    const pending = await client.query<PendingRow>(
      `SELECT outbox_id, person_id, payload
       FROM outbox_events
       WHERE event_type = $1 AND status = 'pending'
       ORDER BY created_at
       LIMIT 500
       FOR UPDATE SKIP LOCKED`,
      [TIMELINE_OUTBOX_EVENT_TYPE],
    );
    const ids = new Set<string>();
    const outboxIds: string[] = [];
    for (const row of pending.rows) {
      // Prefer the authoritative person_id column over the payload copy.
      const personId = row.person_id ?? row.payload.personId ?? '';
      if (personId.length > 0) {
        ids.add(personId);
      }
      outboxIds.push(row.outbox_id);
    }
    return { personIds: [...ids], outboxIds };
  });
  // Write-through: refresh projection for each person (idempotent).
  for (const personId of personIds) {
    await syncPersonTimeline(pool, personId);
  }
  // Mark done only after the projection refresh succeeds, so a crash leaves
  // rows pending (at-least-once) rather than silently dropping them.
  if (outboxIds.length > 0) {
    await runInSystemContext(pool, 'treatment', async (client) => {
      await client.query(
        `UPDATE outbox_events
         SET status = 'done', attempts = attempts + 1, processed_at = now()
         WHERE outbox_id = ANY($1::text[])`,
        [outboxIds],
      );
    });
  }
  return personIds.length;
}

/** Test/ops helper: mark failed for observability without dropping rows. */
export async function failTimelineOutboxEvent(pool: Pool, outboxId: string): Promise<void> {
  await withClient(pool, async (client) => {
    await client.query(
      `UPDATE outbox_events SET status = 'failed', attempts = attempts + 1 WHERE outbox_id = $1`,
      [outboxId],
    );
  });
}
