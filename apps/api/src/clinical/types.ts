/**
 * Phase 6 clinical service types.
 * Every clinical operation goes through Phase 5 PEP then PostgreSQL RLS.
 * Private notes never use ordinary AccessGrant path (I-4).
 */
import type { AuthDeps } from '@health-os/auth';
import { DomainError } from '@health-os/domain';
import type { Pool } from '@health-os/database';

import type { AuthorizationActor, AuthorizationDeps } from '../authorization/types.js';

export type ClinicalFailureCode =
  'forbidden' | 'not_found' | 'conflict' | 'invalid_state' | 'validation' | 'denied';

export class ClinicalError extends Error {
  readonly code: ClinicalFailureCode;
  readonly externalMessage: string;
  readonly denyReason?: string;

  constructor(
    code: ClinicalFailureCode,
    externalMessage: string,
    options?: { cause?: unknown; denyReason?: string },
  ) {
    super(externalMessage, options);
    this.name = 'ClinicalError';
    this.code = code;
    this.externalMessage = externalMessage;
    if (options?.denyReason !== undefined) {
      this.denyReason = options.denyReason;
    }
  }
}

export function toClinicalError(error: unknown): ClinicalError {
  if (error instanceof ClinicalError) {
    return error;
  }
  if (error instanceof DomainError) {
    if (
      error.code.startsWith('INVALID_') &&
      (error.code.includes('TRANSITION') || error.code === 'ASSESSMENT_CONTENT_IMMUTABLE')
    ) {
      return new ClinicalError('invalid_state', 'Invalid state transition', { cause: error });
    }
    return new ClinicalError('validation', 'Invalid request', { cause: error });
  }
  return error instanceof Error
    ? new ClinicalError('validation', error.message, { cause: error })
    : new ClinicalError('validation', 'Unexpected error', { cause: error });
}

export type ClinicalDeps = AuthorizationDeps & {
  readonly pool: Pool;
};

export type ClinicalActor = AuthorizationActor;

export function requirePurpose(purpose: string): string {
  const trimmed = purpose.trim();
  if (trimmed.length === 0) {
    throw new ClinicalError('denied', 'Purpose required', { denyReason: 'PURPOSE_REQUIRED' });
  }
  return trimmed;
}

export function requireProfessional(actor: ClinicalActor): string {
  if (actor.professionalId === null) {
    throw new ClinicalError('forbidden', 'Professional principal required');
  }
  return actor.professionalId;
}

export function requirePersonSelf(actor: ClinicalActor, personId: string): void {
  if (actor.personId !== personId) {
    throw new ClinicalError('not_found', 'Not found');
  }
}

export type { AuthDeps };
