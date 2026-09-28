/**
 * Phase 7 timeline projection — system-context only.
 * Sources: clinical tables + documents + handoffs. NEVER private_professional_notes.
 * Drafts/unsigned assessments never project. Identity is deterministic + idempotent.
 */
import { runInSystemContext, type Pool, type PoolClient } from '@health-os/database';

import {
  assertProjectable,
  timelineEntryId,
  type ProjectableEntry,
  type TimelineSourceType,
} from './types.js';

export const TIMELINE_PROJECTION_VERSION = 1;

export async function upsertTimelineEntry(
  client: PoolClient,
  entry: ProjectableEntry,
): Promise<void> {
  assertProjectable(entry);
  const id = timelineEntryId(entry.personId, entry.sourceType, entry.sourceId);
  await client.query(
    `INSERT INTO timeline_entries (
       timeline_entry_id, person_id, event_type, source_type, source_id, event_at,
       predecessor_source_id, root_source_id, display_title, display_status, projection_version
     ) VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), $7, $8, $9, $10, $11)
     ON CONFLICT (person_id, source_type, source_id) DO UPDATE SET
       event_type = EXCLUDED.event_type,
       event_at = EXCLUDED.event_at,
       predecessor_source_id = EXCLUDED.predecessor_source_id,
       root_source_id = EXCLUDED.root_source_id,
       display_title = EXCLUDED.display_title,
       display_status = EXCLUDED.display_status,
       projection_version = EXCLUDED.projection_version`,
    [
      id,
      entry.personId,
      entry.eventType,
      entry.sourceType,
      entry.sourceId,
      entry.eventAt,
      entry.predecessorSourceId ?? null,
      entry.rootSourceId ?? null,
      entry.displayTitle ?? null,
      entry.displayStatus ?? null,
      TIMELINE_PROJECTION_VERSION,
    ],
  );
}

export async function deleteTimelineEntry(
  client: PoolClient,
  personId: string,
  sourceType: TimelineSourceType,
  sourceId: string,
): Promise<void> {
  await client.query(
    `DELETE FROM timeline_entries WHERE person_id = $1 AND source_type = $2 AND source_id = $3`,
    [personId, sourceType, sourceId],
  );
}

async function collectEntriesForPerson(
  client: PoolClient,
  personId: string,
): Promise<readonly ProjectableEntry[]> {
  const entries: ProjectableEntry[] = [];

  // Observations — all (SHARED_HEALTH path; private notes not in this table).
  const obs = await client.query<{
    observation_id: string;
    person_id: string;
    code: string;
    observed_at: Date;
  }>(
    `SELECT observation_id, person_id, code, observed_at
     FROM observations WHERE person_id = $1`,
    [personId],
  );
  for (const row of obs.rows) {
    entries.push({
      personId: row.person_id,
      sourceType: 'observation',
      sourceId: row.observation_id,
      eventType: 'observation_recorded',
      eventAt: row.observed_at.getTime(),
      displayTitle: row.code,
      displayStatus: 'recorded',
    });
  }

  // Assessments — signed + amended only (never draft) (§11).
  const assessments = await client.query<{
    assessment_id: string;
    person_id: string;
    status: string;
    title: string;
    version: number;
    predecessor_assessment_id: string | null;
    signed_at: Date | null;
    amended_at: Date | null;
    updated_at: Date;
  }>(
    `SELECT assessment_id, person_id, status, title, version,
            predecessor_assessment_id, signed_at, amended_at, updated_at
     FROM assessments
     WHERE person_id = $1 AND status IN ('signed', 'amended')`,
    [personId],
  );
  for (const row of assessments.rows) {
    const eventType = row.status === 'amended' ? 'assessment_amended' : 'assessment_signed';
    const eventAt = (row.amended_at ?? row.signed_at ?? row.updated_at).getTime();
    entries.push({
      personId: row.person_id,
      sourceType: 'assessment',
      sourceId: row.assessment_id,
      eventType,
      eventAt,
      predecessorSourceId: row.predecessor_assessment_id,
      rootSourceId: row.predecessor_assessment_id,
      displayTitle: row.title,
      displayStatus: row.status,
    });
  }

  // Goals — timeline-worthy statuses only (proposed is contractually worthy per domain).
  const goals = await client.query<{
    goal_id: string;
    person_id: string;
    status: string;
    title: string;
    updated_at: Date;
    created_at: Date;
  }>(
    `SELECT goal_id, person_id, status, title, updated_at, created_at
     FROM goals WHERE person_id = $1`,
    [personId],
  );
  const goalEvent: Record<string, ProjectableEntry['eventType']> = {
    proposed: 'goal_proposed',
    active: 'goal_activated',
    achieved: 'goal_achieved',
    abandoned: 'goal_abandoned',
  };
  for (const row of goals.rows) {
    const eventType = goalEvent[row.status];
    if (eventType === undefined) continue;
    entries.push({
      personId: row.person_id,
      sourceType: 'goal',
      sourceId: row.goal_id,
      eventType,
      eventAt: (row.status === 'proposed' ? row.created_at : row.updated_at).getTime(),
      displayTitle: row.title,
      displayStatus: row.status,
    });
  }

  // Care plans — draft excluded (§11).
  const plans = await client.query<{
    care_plan_id: string;
    person_id: string;
    status: string;
    title: string;
    updated_at: Date;
  }>(
    `SELECT care_plan_id, person_id, status, title, updated_at
     FROM care_plans WHERE person_id = $1 AND status <> 'draft'`,
    [personId],
  );
  const planEvent: Record<string, ProjectableEntry['eventType']> = {
    active: 'care_plan_activated',
    completed: 'care_plan_completed',
    cancelled: 'care_plan_cancelled',
  };
  for (const row of plans.rows) {
    const eventType = planEvent[row.status];
    if (eventType === undefined) continue;
    entries.push({
      personId: row.person_id,
      sourceType: 'care_plan',
      sourceId: row.care_plan_id,
      eventType,
      eventAt: row.updated_at.getTime(),
      displayTitle: row.title,
      displayStatus: row.status,
    });
  }

  // Interventions — lifecycle events only (planned is pre-start, not projected).
  const interventions = await client.query<{
    intervention_id: string;
    person_id: string;
    status: string;
    title: string;
    updated_at: Date;
  }>(
    `SELECT intervention_id, person_id, status, title, updated_at
     FROM interventions WHERE person_id = $1 AND status <> 'planned'`,
    [personId],
  );
  const interventionEvent: Record<string, ProjectableEntry['eventType']> = {
    in_progress: 'intervention_started',
    completed: 'intervention_completed',
    cancelled: 'intervention_cancelled',
  };
  for (const row of interventions.rows) {
    const eventType = interventionEvent[row.status];
    if (eventType === undefined) continue;
    entries.push({
      personId: row.person_id,
      sourceType: 'intervention',
      sourceId: row.intervention_id,
      eventType,
      eventAt: row.updated_at.getTime(),
      displayTitle: row.title,
      displayStatus: row.status,
    });
  }

  // Outcomes
  const outcomes = await client.query<{
    outcome_id: string;
    person_id: string;
    summary: string;
    recorded_at: Date;
  }>(
    `SELECT outcome_id, person_id, summary, recorded_at
     FROM outcomes WHERE person_id = $1`,
    [personId],
  );
  for (const row of outcomes.rows) {
    entries.push({
      personId: row.person_id,
      sourceType: 'outcome',
      sourceId: row.outcome_id,
      eventType: 'outcome_recorded',
      eventAt: row.recorded_at.getTime(),
      displayTitle: row.summary.slice(0, 200),
      displayStatus: 'recorded',
    });
  }

  // Documents — available only (lifecycle reference).
  const docs = await client.query<{
    document_id: string;
    person_id: string;
    title: string;
    updated_at: Date;
  }>(
    `SELECT document_id, person_id, title, updated_at
     FROM documents WHERE person_id = $1 AND status = 'available'`,
    [personId],
  );
  for (const row of docs.rows) {
    entries.push({
      personId: row.person_id,
      sourceType: 'document',
      sourceId: row.document_id,
      eventType: 'document_available',
      eventAt: row.updated_at.getTime(),
      displayTitle: row.title,
      displayStatus: 'available',
    });
  }

  // Handoffs — terminal-ish lifecycle kinds already in domain (no Phase 8 features).
  const handoffs = await client.query<{
    handoff_id: string;
    person_id: string;
    status: string;
    summary: string;
    sent_at: Date | null;
    acknowledged_at: Date | null;
    closed_at: Date | null;
    updated_at: Date;
  }>(
    `SELECT handoff_id, person_id, status, summary, sent_at, acknowledged_at, closed_at, updated_at
     FROM handoffs WHERE person_id = $1 AND status IN ('sent', 'acknowledged', 'closed')`,
    [personId],
  );
  const handoffEvent: Record<string, ProjectableEntry['eventType']> = {
    sent: 'handoff_sent',
    acknowledged: 'handoff_acknowledged',
    closed: 'handoff_closed',
  };
  for (const row of handoffs.rows) {
    const eventType = handoffEvent[row.status];
    if (eventType === undefined) continue;
    const eventAt = (
      row.closed_at ??
      row.acknowledged_at ??
      row.sent_at ??
      row.updated_at
    ).getTime();
    entries.push({
      personId: row.person_id,
      sourceType: 'handoff',
      sourceId: row.handoff_id,
      eventType,
      eventAt,
      displayTitle: row.summary.slice(0, 200),
      displayStatus: row.status,
    });
  }

  // Structural guard: never project private notes (I-4).
  if (entries.some((e) => e.sourceType === ('private_note' as TimelineSourceType))) {
    throw new Error('private note leaked into projection');
  }

  return entries;
}

/**
 * Deterministic rebuild for one person: replace projection from canonical sources.
 * Production strategy: run under system context; safe to rerun; no orphans.
 */
export async function rebuildPersonTimeline(pool: Pool, personId: string): Promise<number> {
  return runInSystemContext(pool, 'treatment', async (client) => {
    await client.query(`DELETE FROM timeline_entries WHERE person_id = $1`, [personId]);
    const entries = await collectEntriesForPerson(client, personId);
    for (const entry of entries) {
      await upsertTimelineEntry(client, entry);
    }
    return entries.length;
  });
}

/** Idempotent refresh: upsert current canonical state + remove orphans for person. */
export async function syncPersonTimeline(pool: Pool, personId: string): Promise<number> {
  return runInSystemContext(pool, 'treatment', async (client) => {
    const entries = await collectEntriesForPerson(client, personId);
    const keep = new Set(entries.map((e) => timelineEntryId(e.personId, e.sourceType, e.sourceId)));
    const existing = await client.query<{ timeline_entry_id: string }>(
      `SELECT timeline_entry_id FROM timeline_entries WHERE person_id = $1`,
      [personId],
    );
    for (const row of existing.rows) {
      if (!keep.has(row.timeline_entry_id)) {
        await client.query(`DELETE FROM timeline_entries WHERE timeline_entry_id = $1`, [
          row.timeline_entry_id,
        ]);
      }
    }
    for (const entry of entries) {
      await upsertTimelineEntry(client, entry);
    }
    return entries.length;
  });
}

/** Destructive full-table rebuild for tests / controlled ops (system context). */
export async function rebuildAllTimelines(pool: Pool): Promise<number> {
  return runInSystemContext(pool, 'treatment', async (client) => {
    const persons = await client.query<{ person_id: string }>(`SELECT person_id FROM persons`);
    let total = 0;
    for (const row of persons.rows) {
      await client.query(`DELETE FROM timeline_entries WHERE person_id = $1`, [row.person_id]);
      const entries = await collectEntriesForPerson(client, row.person_id);
      for (const entry of entries) {
        await upsertTimelineEntry(client, entry);
        total += 1;
      }
    }
    return total;
  });
}
