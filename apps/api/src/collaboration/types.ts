/**
 * Collaboration service types — Phase 4.
 * Actor is always derived from the authenticated Phase 3 session (never client-supplied).
 * Collaboration authz answers org/care-team/invitation questions only — never health reads (I-3).
 */
import type { AuthenticatedPrincipal, AuthDeps } from '@health-os/auth';
import { DomainError, type OrganizationRole } from '@health-os/domain';
import type { Pool, PoolClient } from '@health-os/database';

export function toCollaborationError(error: unknown): CollaborationError {
  if (error instanceof CollaborationError) {
    return error;
  }
  if (error instanceof DomainError) {
    if (error.code === 'INVALID_STATE_TRANSITION') {
      return new CollaborationError('invalid_state', 'Invalid state transition', { cause: error });
    }
    return new CollaborationError('validation', 'Invalid request', { cause: error });
  }
  return error instanceof Error
    ? new CollaborationError('validation', error.message, { cause: error })
    : new CollaborationError('validation', 'Unexpected error', { cause: error });
}

export type CollaborationDeps = AuthDeps & {
  readonly pool: Pool;
  readonly onEvent?: (event: CollaborationSecurityEvent) => void;
};

export interface CollaborationActor {
  readonly accountId: string;
  readonly personId: string | null;
  readonly professionalId: string | null;
  readonly emailNormalized: string;
}

export function actorFromPrincipal(principal: AuthenticatedPrincipal): CollaborationActor {
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

export type CollaborationFailureCode =
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'invalid_state'
  | 'wrong_recipient'
  | 'expired_token'
  | 'invalid_token'
  | 'validation';

export class CollaborationError extends Error {
  readonly code: CollaborationFailureCode;
  readonly externalMessage: string;

  constructor(
    code: CollaborationFailureCode,
    externalMessage: string,
    options?: { cause?: unknown },
  ) {
    super(externalMessage, options);
    this.name = 'CollaborationError';
    this.code = code;
    this.externalMessage = externalMessage;
  }
}

export const COLLABORATION_EVENT_TYPES = [
  'organization_created',
  'organization_status_changed',
  'membership_invited',
  'membership_activated',
  'membership_ended',
  'role_changed',
  'care_team_created',
  'care_team_closed',
  'care_team_member_added',
  'care_team_member_removed',
  'invitation_created',
  'invitation_claimed',
  'invitation_rejected',
  'invitation_expired',
  'invitation_revoked',
  'relationship_started',
  'relationship_ended',
] as const;

export type CollaborationEventType = (typeof COLLABORATION_EVENT_TYPES)[number];

export interface CollaborationSecurityEvent {
  readonly eventType: CollaborationEventType;
  readonly organizationId?: string | null;
  readonly personId?: string | null;
  readonly professionalId?: string | null;
  readonly invitationId?: string | null;
  readonly actorPrincipalType?: 'person' | 'professional' | 'system' | null;
  readonly actorPrincipalId?: string | null;
  readonly contactHint?: string | null;
  readonly ipHint?: string | null;
  readonly requestId?: string | null;
  readonly metadata?: Record<string, unknown>;
}

export function assertNoForbiddenEventMetadata(metadata: Record<string, unknown>): void {
  for (const key of ['token', 'password', 'session_token', 'health']) {
    if (Object.prototype.hasOwnProperty.call(metadata, key)) {
      throw new CollaborationError('validation', 'forbidden metadata', { cause: key });
    }
  }
}

export async function insertCollaborationEvent(
  client: PoolClient,
  event: CollaborationSecurityEvent,
): Promise<void> {
  const metadata = event.metadata ?? {};
  assertNoForbiddenEventMetadata(metadata);
  await client.query(
    `INSERT INTO collaboration_security_events (
       event_type, organization_id, person_id, professional_id, invitation_id,
       actor_principal_type, actor_principal_id, contact_hint, ip_hint, request_id, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
    [
      event.eventType,
      event.organizationId ?? null,
      event.personId ?? null,
      event.professionalId ?? null,
      event.invitationId ?? null,
      event.actorPrincipalType ?? null,
      event.actorPrincipalId ?? null,
      event.contactHint ?? null,
      event.ipHint ?? null,
      event.requestId ?? null,
      JSON.stringify(metadata),
    ],
  );
}

export async function loadActiveOrgMembership(
  client: PoolClient,
  organizationId: string,
  professionalId: string,
): Promise<{ membershipId: string; role: OrganizationRole; status: string } | null> {
  const res = await client.query<{
    membership_id: string;
    role: string;
    status: string;
  }>(
    `SELECT membership_id, role, status
     FROM organization_memberships
     WHERE organization_id = $1 AND professional_id = $2
       AND status = 'active'
     FOR UPDATE`,
    [organizationId, professionalId],
  );
  const row = res.rows[0];
  if (row === undefined) {
    return null;
  }
  return {
    membershipId: row.membership_id,
    role: row.role as OrganizationRole,
    status: row.status,
  };
}

export function requireOrgAdmin(membership: { role: OrganizationRole } | null): void {
  if (membership === null || (membership.role !== 'owner' && membership.role !== 'admin')) {
    throw new CollaborationError('forbidden', 'Not permitted');
  }
}

export function requireOrgMember(membership: { role: OrganizationRole } | null): void {
  if (membership === null) {
    throw new CollaborationError('forbidden', 'Not permitted');
  }
}
