/**
 * Timeline-worthy event kind tags only (ADR-0010).
 * Projection, queries, and persistence belong to the timeline service (Phase 7).
 * Private notes and unapproved AI drafts are never timeline events.
 * Phase 7 adds observation_recorded + document_available (contract §2).
 */
export type TimelineEventKind =
  | 'observation_recorded'
  | 'assessment_signed'
  | 'assessment_amended'
  | 'goal_proposed'
  | 'goal_activated'
  | 'goal_achieved'
  | 'goal_abandoned'
  | 'care_plan_activated'
  | 'care_plan_completed'
  | 'care_plan_cancelled'
  | 'intervention_started'
  | 'intervention_completed'
  | 'intervention_cancelled'
  | 'outcome_recorded'
  | 'document_available'
  | 'handoff_sent'
  | 'handoff_acknowledged'
  | 'handoff_closed';

export type TimelineSourceType =
  | 'observation'
  | 'assessment'
  | 'goal'
  | 'care_plan'
  | 'intervention'
  | 'outcome'
  | 'document'
  | 'handoff';

export interface TimelineEventRef {
  readonly kind: TimelineEventKind;
  readonly personId: string;
  readonly aggregateId: string;
  readonly occurredAt: number;
}

export function isTimelineWorthy(kind: TimelineEventKind): boolean {
  return TIMELINE_EVENT_KINDS.includes(kind);
}

export const TIMELINE_EVENT_KINDS: readonly TimelineEventKind[] = [
  'observation_recorded',
  'assessment_signed',
  'assessment_amended',
  'goal_proposed',
  'goal_activated',
  'goal_achieved',
  'goal_abandoned',
  'care_plan_activated',
  'care_plan_completed',
  'care_plan_cancelled',
  'intervention_started',
  'intervention_completed',
  'intervention_cancelled',
  'outcome_recorded',
  'document_available',
  'handoff_sent',
  'handoff_acknowledged',
  'handoff_closed',
];

export const TIMELINE_SOURCE_TYPES: readonly TimelineSourceType[] = [
  'observation',
  'assessment',
  'goal',
  'care_plan',
  'intervention',
  'outcome',
  'document',
  'handoff',
];

/** Structural exclusion: private notes are not a timeline source type (I-4). */
export function isPrivateNoteSourceType(sourceType: string): boolean {
  return sourceType === 'private_note' || sourceType === 'private_professional_note';
}

export function createTimelineEventRef(input: TimelineEventRef): TimelineEventRef {
  return { ...input };
}
