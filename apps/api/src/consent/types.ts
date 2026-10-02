/**
 * Phase 5 consent service types.
 * Actor is always from the authenticated session (never client-supplied).
 * Consent mutations run under system context; AccessGrants are compiler artifacts.
 */
import type { AuthDeps } from '@health-os/auth';
import { DomainError } from '@health-os/domain';
import type { Pool, PoolClient } from '@health-os/database';

export type ConsentFailureCode =
  'forbidden' | 'not_found' | 'conflict' | 'invalid_state' | 'validation';

export class ConsentError extends Error {
  readonly code: ConsentFailureCode;
  readonly externalMessage: string;

  constructor(code: ConsentFailureCode, externalMessage: string, options?: { cause?: unknown }) {
    super(externalMessage, options);
    this.name = 'ConsentError';
    this.code = code;
    this.externalMessage = externalMessage;
  }
}

export function toConsentError(error: unknown): ConsentError {
  if (error instanceof ConsentError) {
    return error;
  }
  if (error instanceof DomainError) {
    if (
      error.code === 'INVALID_CONSENT_TRANSITION' ||
      error.code === 'INVALID_ACCESS_REQUEST_TRANSITION' ||
      error.code === 'INVALID_STATE_TRANSITION'
    ) {
      return new ConsentError('invalid_state', 'Invalid state transition', { cause: error });
    }
    return new ConsentError('validation', 'Invalid request', { cause: error });
  }
  return error instanceof Error
    ? new ConsentError('validation', 'Invalid request', { cause: error })
    : new ConsentError('validation', 'Unexpected error', { cause: error });
}

export type ConsentDeps = AuthDeps & {
  readonly pool: Pool;
  readonly onAudit?: (entry: ConsentAuditEntry) => void;
};

export interface ConsentActor {
  readonly accountId: string;
  readonly personId: string | null;
  readonly professionalId: string | null;
  readonly emailNormalized: string;
}

export interface ConsentAuditEntry {
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly personId: string;
  readonly actorPrincipalType: 'person' | 'professional' | 'system';
  readonly actorPrincipalId: string;
  readonly purpose: string | null;
  readonly accessDecision?: 'allow' | 'deny' | null;
  readonly metadata?: Record<string, unknown>;
}

/** I-10: health/consent access path always writes an immutable audit row (same tx). */
export async function insertConsentAudit(
  client: PoolClient,
  entry: ConsentAuditEntry,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (
       actor_principal_type, actor_principal_id, action, resource_type, resource_id,
       person_id, purpose, access_decision, metadata
     ) VALUES ($1, $2::uuid, $3, $4, $5::uuid, $6::uuid, $7, $8, $9::jsonb)`,
    [
      entry.actorPrincipalType,
      entry.actorPrincipalId,
      entry.action,
      entry.resourceType,
      entry.resourceId,
      entry.personId,
      entry.purpose,
      entry.accessDecision ?? null,
      JSON.stringify(entry.metadata ?? {}),
    ],
  );
}

export const SYSTEM_PRINCIPAL_ID = '00000000-0000-0000-0000-000000000001';
