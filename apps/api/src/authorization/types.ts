/**
 * Phase 5 authorization service types.
 * Actor always from Phase 3 session; AuthorizationContext is server-derived only.
 */
import type { AuthenticatedPrincipal, AuthDeps } from '@health-os/auth';
import { DomainError } from '@health-os/domain';
import type { Pool, PoolClient } from '@health-os/database';

export type AuthorizationFailureCode =
  'forbidden' | 'not_found' | 'conflict' | 'invalid_state' | 'validation' | 'denied';

export class AuthorizationError extends Error {
  readonly code: AuthorizationFailureCode;
  readonly externalMessage: string;
  readonly denyReason?: string;

  constructor(
    code: AuthorizationFailureCode,
    externalMessage: string,
    options?: { cause?: unknown; denyReason?: string },
  ) {
    super(externalMessage, options);
    this.name = 'AuthorizationError';
    this.code = code;
    this.externalMessage = externalMessage;
    if (options?.denyReason !== undefined) {
      this.denyReason = options.denyReason;
    }
  }
}

export function toAuthorizationError(error: unknown): AuthorizationError {
  if (error instanceof AuthorizationError) {
    return error;
  }
  if (error instanceof DomainError) {
    if (
      error.code === 'INVALID_CONSENT_TRANSITION' ||
      error.code === 'INVALID_ACCESS_REQUEST_TRANSITION' ||
      error.code === 'INVALID_STATE_TRANSITION'
    ) {
      return new AuthorizationError('invalid_state', 'Invalid state transition', { cause: error });
    }
    return new AuthorizationError('validation', 'Invalid request', { cause: error });
  }
  return error instanceof Error
    ? new AuthorizationError('validation', 'Invalid request', { cause: error })
    : new AuthorizationError('validation', 'Unexpected error', { cause: error });
}

export type AuthorizationDeps = AuthDeps & {
  readonly pool: Pool;
  readonly onEvent?: (event: AuthorizationSecurityEvent) => void;
};

export interface AuthorizationActor {
  readonly accountId: string;
  readonly personId: string | null;
  readonly professionalId: string | null;
  readonly emailNormalized: string;
}

export function actorFromPrincipal(principal: AuthenticatedPrincipal): AuthorizationActor {
  if (principal.personId === null && principal.professionalId === null) {
    throw new Error('actor has no person or professional link');
  }
  return {
    accountId: principal.accountId,
    personId: principal.personId,
    professionalId: principal.professionalId,
    emailNormalized: principal.emailNormalized,
  };
}

export type AuthorizationEventType =
  | 'consent_issued'
  | 'consent_revoked'
  | 'consent_narrowed'
  | 'access_request_created'
  | 'access_request_accepted'
  | 'access_request_rejected'
  | 'access_request_withdrawn'
  | 'grants_compiled'
  | 'grants_revoked'
  | 'health_access_allowed'
  | 'health_access_denied'
  | 'membership_grants_revoked';

export interface AuthorizationSecurityEvent {
  readonly eventType: AuthorizationEventType;
  readonly personId?: string | null;
  readonly professionalId?: string | null;
  readonly actorPrincipalType?: 'person' | 'professional' | 'system' | null;
  readonly actorPrincipalId?: string | null;
  readonly requestId?: string | null;
  readonly metadata?: Record<string, unknown>;
}

export function assertNoForbiddenAuthMetadata(metadata: Record<string, unknown>): void {
  const forbidden = new Set(['token', 'password', 'session_token', 'health', 'body']);
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (forbidden.has(key)) {
        throw new AuthorizationError('validation', 'forbidden metadata', { cause: key });
      }
      walk(child);
    }
  };
  walk(metadata);
}

export async function insertAuthorizationEvent(
  client: PoolClient,
  event: AuthorizationSecurityEvent,
): Promise<void> {
  const metadata = event.metadata ?? {};
  assertNoForbiddenAuthMetadata(metadata);
  await client.query(
    `INSERT INTO audit_logs (
       actor_principal_type, actor_principal_id, action, resource_type, resource_id,
       person_id, purpose, access_decision, severity, metadata
     ) VALUES ($1, $2, $3, 'authorization', NULL, $4, $5, $6, 'info', $7::jsonb)`,
    [
      event.actorPrincipalType ?? null,
      event.actorPrincipalId ?? null,
      event.eventType,
      event.personId ?? null,
      typeof event.metadata?.purpose === 'string' ? event.metadata.purpose : null,
      event.eventType.includes('denied') || event.eventType.includes('revoked')
        ? 'deny'
        : event.eventType.includes('allowed') || event.eventType.includes('issued')
          ? 'allow'
          : null,
      JSON.stringify(metadata),
    ],
  );
}

export async function emitAuthorizationEvent(
  client: PoolClient,
  deps: Pick<AuthorizationDeps, 'onEvent'>,
  event: AuthorizationSecurityEvent,
): Promise<void> {
  await insertAuthorizationEvent(client, event);
  deps.onEvent?.(event);
}
