import { DomainError, invalidValue } from './errors.js';

export const DATA_CLASSES: readonly [
  'PUBLIC',
  'INTERNAL',
  'PERSON_PRIVATE',
  'SHARED_HEALTH',
  'PROFESSIONAL_PRIVATE',
  'HIGH_SENSITIVITY',
  'SYSTEM_SECURITY',
] = [
  'PUBLIC',
  'INTERNAL',
  'PERSON_PRIVATE',
  'SHARED_HEALTH',
  'PROFESSIONAL_PRIVATE',
  'HIGH_SENSITIVITY',
  'SYSTEM_SECURITY',
];

export type DataClass = (typeof DATA_CLASSES)[number];

export const ACCESS_CATEGORIES: readonly [
  'timeline_read',
  'assessment_read',
  'assessment_write',
  'goal_read',
  'goal_write',
  'care_plan_read',
  'care_plan_write',
  'intervention_read',
  'outcome_read',
  'handoff_read',
  'handoff_write',
  'document_read',
  'private_note_read',
  'ai_context',
] = [
  'timeline_read',
  'assessment_read',
  'assessment_write',
  'goal_read',
  'goal_write',
  'care_plan_read',
  'care_plan_write',
  'intervention_read',
  'outcome_read',
  'handoff_read',
  'handoff_write',
  'document_read',
  'private_note_read',
  'ai_context',
];

export type AccessCategory = (typeof ACCESS_CATEGORIES)[number];

export const ACCESS_PURPOSES: readonly [
  'treatment',
  'care_coordination',
  'payment_admin',
  'person_requested',
  'ai_assistance',
  'break_glass',
] = [
  'treatment',
  'care_coordination',
  'payment_admin',
  'person_requested',
  'ai_assistance',
  'break_glass',
];

export type AccessPurpose = (typeof ACCESS_PURPOSES)[number];

export type RelationshipClass =
  'care_team_member' | 'invited_professional' | 'organization_staff' | 'person_self' | 'none';

/**
 * Who is acting. Distinct from identity infrastructure (auth is later phases).
 * AI actors never sign or attest (ADR-0012/0013).
 */
export type ActorKind = 'human_professional' | 'human_person' | 'machine';

export interface Actor {
  readonly kind: ActorKind;
  readonly label: string;
}

export function humanProfessional(label: string): Actor {
  const trimmed = label.trim();
  if (trimmed.length === 0) {
    throw invalidValue('Actor', 'professional label must be non-empty');
  }
  return { kind: 'human_professional', label: trimmed };
}

export function humanPerson(label: string): Actor {
  const trimmed = label.trim();
  if (trimmed.length === 0) {
    throw invalidValue('Actor', 'person label must be non-empty');
  }
  return { kind: 'human_person', label: trimmed };
}

export function machineActor(label: string): Actor {
  const trimmed = label.trim();
  if (trimmed.length === 0) {
    throw invalidValue('Actor', 'machine label must be non-empty');
  }
  return { kind: 'machine', label: trimmed };
}

export function isMachine(actor: Actor): boolean {
  return actor.kind === 'machine';
}

export function parseAccessCategory(raw: string): AccessCategory {
  if ((ACCESS_CATEGORIES as readonly string[]).includes(raw)) {
    return raw as AccessCategory;
  }
  throw new DomainError('UNKNOWN_ACCESS_CATEGORY', `Unknown access category: ${raw}`, {
    reason: raw,
  });
}

export function parseAccessPurpose(raw: string): AccessPurpose {
  if ((ACCESS_PURPOSES as readonly string[]).includes(raw)) {
    return raw as AccessPurpose;
  }
  throw new DomainError('UNKNOWN_ACCESS_PURPOSE', `Unknown access purpose: ${raw}`, {
    reason: raw,
  });
}

export function isKnownAccessCategory(raw: string): raw is AccessCategory {
  return (ACCESS_CATEGORIES as readonly string[]).includes(raw);
}

export function isKnownAccessPurpose(raw: string): raw is AccessPurpose {
  return (ACCESS_PURPOSES as readonly string[]).includes(raw);
}

export interface TimeWindow {
  readonly effectiveFrom: number;
  readonly effectiveUntil: number | null;
}

export function windowActive(window: TimeWindow, at: number): boolean {
  if (at < window.effectiveFrom) {
    return false;
  }
  if (window.effectiveUntil === null) {
    return true;
  }
  return at <= window.effectiveUntil;
}

export function requireNonEmpty(entity: string, field: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw invalidValue(entity, `${field} must be non-empty`);
  }
  return trimmed;
}

export function requirePositiveNumber(entity: string, field: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw invalidValue(entity, `${field} must be a positive finite number`);
  }
  return value;
}

export function requireNonNegativeNumber(entity: string, field: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw invalidValue(entity, `${field} must be a non-negative finite number`);
  }
  return value;
}
