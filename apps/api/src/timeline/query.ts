/**
 * Timeline query layer — Phase 7.
 * Flow: require purpose → PEP authorizeClinical(timeline_read) → sync projection
 * (read-your-writes) → RLS keyset query → audit via PEP → cursor.
 * Projection membership is NEVER authorization (§4).
 */
import { authorizeClinical, runClinicalAsPrincipal } from '../clinical/pep.js';
import { ClinicalError } from '../clinical/types.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import { processTimelineOutbox } from './outbox.js';
import { syncPersonTimeline } from './project.js';
import {
  TimelineError,
  type TimelineActor,
  type TimelineDeps,
  type TimelineEntry,
  type TimelineEventKind,
  type TimelineFilters,
  type TimelinePage,
  type TimelineSourceType,
} from './types.js';

interface EntryRow {
  timeline_entry_id: string;
  person_id: string;
  event_type: string;
  source_type: string;
  source_id: string;
  event_at: Date;
  created_at: Date;
  predecessor_source_id: string | null;
  root_source_id: string | null;
  display_title: string | null;
  display_status: string | null;
  projection_version: number;
}

function mapRow(row: EntryRow): TimelineEntry {
  return {
    timelineEntryId: row.timeline_entry_id,
    personId: row.person_id,
    eventType: row.event_type as TimelineEventKind,
    sourceType: row.source_type as TimelineSourceType,
    sourceId: row.source_id,
    eventAt: row.event_at.getTime(),
    createdAt: row.created_at.getTime(),
    predecessorSourceId: row.predecessor_source_id,
    rootSourceId: row.root_source_id,
    displayTitle: row.display_title,
    displayStatus: row.display_status,
    projectionVersion: row.projection_version,
  };
}

export interface ListTimelineInput {
  readonly personId: string;
  readonly purpose: string;
  readonly limit?: number;
  readonly cursor?: string;
  readonly filters?: TimelineFilters;
  readonly requestId?: string;
  /**
   * When true (default), refresh projection from canonical sources before read
   * (read-your-writes / ADR-0014 write-through path). Set false only for pure
   * projection-latency measurements.
   */
  readonly sync?: boolean;
}

export async function listTimeline(
  deps: TimelineDeps,
  actor: TimelineActor,
  input: ListTimelineInput,
): Promise<TimelinePage> {
  // Purpose fail-closed before any DB work (I-19).
  if (input.purpose.trim().length === 0) {
    throw new ClinicalError('denied', 'Purpose required', { denyReason: 'PURPOSE_REQUIRED' });
  }

  // Read-time PEP (I-1): projection row presence is not authorization.
  await authorizeClinical(deps, actor, {
    personId: input.personId,
    category: 'timeline_read',
    purpose: input.purpose,
    action: 'read',
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  });

  const filters: TimelineFilters = input.filters ?? {};
  const rawLimit = input.limit ?? 20;
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : 20;
  const from = filters.from !== undefined ? new Date(filters.from) : null;
  const to = filters.to !== undefined ? new Date(filters.to) : null;
  if (
    (from !== null && Number.isNaN(from.getTime())) ||
    (to !== null && Number.isNaN(to.getTime()))
  ) {
    throw new TimelineError('validation', 'Invalid timeline date filter');
  }

  // Read-your-writes: drain outbox + idempotent sync from canonical sources.
  if (input.sync !== false) {
    try {
      const pool = deps.pool;
      await processTimelineOutbox(pool);
      await syncPersonTimeline(pool, input.personId);
    } catch {
      // Projection refresh is best-effort; RLS still protects rows.
      // Failures surface on next successful sync; PEP already allowed the read.
    }
  }

  let cursorKey: { eventAt: string; entryId: string } | null = null;
  if (input.cursor !== undefined && input.cursor.length > 0) {
    try {
      const secret = (deps as { cursorSecret?: Buffer }).cursorSecret;
      cursorKey = decodeCursor(input.cursor, { personId: input.personId, filters }, secret);
    } catch {
      throw new ClinicalError('validation', 'Invalid cursor');
    }
  }

  const eventTypes = filters.eventTypes ?? [];
  const sourceTypes = filters.sourceTypes ?? [];

  const page = await runClinicalAsPrincipal(
    deps,
    actor,
    {
      purpose: input.purpose,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    },
    async (client) => {
      const res = await client.query<EntryRow>(
        `SELECT timeline_entry_id, person_id, event_type, source_type, source_id,
                event_at, created_at, predecessor_source_id, root_source_id,
                display_title, display_status, projection_version
         FROM timeline_entries
         WHERE person_id = $1
           AND ($2::text[] IS NULL OR event_type = ANY($2::text[]))
           AND ($3::text[] IS NULL OR source_type = ANY($3::text[]))
           AND ($4::timestamptz IS NULL OR event_at >= $4::timestamptz)
           AND ($5::timestamptz IS NULL OR event_at <= $5::timestamptz)
           AND (
             $6::timestamptz IS NULL
             OR event_at < $6::timestamptz
             OR (event_at = $6::timestamptz AND timeline_entry_id < $7::uuid)
           )
         ORDER BY event_at DESC, timeline_entry_id DESC
         LIMIT $8`,
        [
          input.personId,
          eventTypes.length > 0 ? eventTypes : null,
          sourceTypes.length > 0 ? sourceTypes : null,
          from,
          to,
          cursorKey !== null ? new Date(cursorKey.eventAt) : null,
          cursorKey !== null ? cursorKey.entryId : '00000000-0000-0000-0000-000000000000',
          limit + 1,
        ],
      );
      return res.rows;
    },
  );

  const hasMore = page.length > limit;
  const entries = (hasMore ? page.slice(0, limit) : page).map(mapRow);
  const last = entries[entries.length - 1];
  const nextCursor =
    hasMore && last !== undefined
      ? encodeCursor(
          {
            p: input.personId,
            t: new Date(last.eventAt).toISOString(),
            i: last.timelineEntryId,
            filters,
          },
          (deps as { cursorSecret?: Buffer }).cursorSecret,
        )
      : null;

  return { entries, nextCursor };
}
