/**
 * Structured domain errors (Phase 1).
 * No free-form strings as failure signals; callers switch on `code`.
 */
export type DomainErrorCode =
  | 'INVALID_DOMAIN_VALUE'
  | 'INVALID_STATE_TRANSITION'
  | 'INVALID_CONSENT_TRANSITION'
  | 'INVALID_ASSESSMENT_TRANSITION'
  | 'INVALID_HANDOFF_TRANSITION'
  | 'INVALID_INVITATION_TRANSITION'
  | 'INVALID_ACCESS_REQUEST_TRANSITION'
  | 'INVALID_GOAL_TRANSITION'
  | 'INVALID_CARE_PLAN_TRANSITION'
  | 'INVALID_INTERVENTION_TRANSITION'
  | 'INVALID_OUTCOME_TRANSITION'
  | 'INVALID_PRIVATE_NOTE_TRANSITION'
  | 'EXPIRED_INVITATION'
  | 'REPLAY_ATTEMPT'
  | 'PRIVATE_NOTE_CANNOT_BE_SHARED'
  | 'INVALID_PROMOTION'
  | 'MACHINE_ACTOR_FORBIDDEN'
  | 'UNKNOWN_ACCESS_CATEGORY'
  | 'UNKNOWN_ACCESS_PURPOSE'
  | 'HANDOFF_MANIFEST_LOCKED'
  | 'ASSESSMENT_CONTENT_IMMUTABLE'
  | 'CONSENT_REVISION_IMMUTABLE'
  | 'INVALID_DOCUMENT_TRANSITION'
  | 'DOCUMENT_NOT_AVAILABLE';

export interface DomainErrorDetails {
  readonly from?: string;
  readonly to?: string;
  readonly entity?: string;
  readonly reason?: string;
}

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: DomainErrorDetails;
  constructor(code: DomainErrorCode, message: string, details: DomainErrorDetails = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export function invalidValue(entity: string, reason: string): DomainError {
  return new DomainError('INVALID_DOMAIN_VALUE', `${entity}: ${reason}`, { entity, reason });
}

export function invalidTransition(
  entity: string,
  code: DomainErrorCode,
  from: string,
  to: string,
  reason?: string,
): DomainError {
  const details = reason ? { entity, from, to, reason } : { entity, from, to };
  return new DomainError(code, `${entity}: cannot transition ${from} → ${to}`, details);
}
