import { DomainError, invalidTransition } from './errors.js';
import { requireNonEmpty } from './primitives.js';
import type { InvitationId, OrganizationId, PersonId, ProfessionalId } from './ids.js';

const INVITATION_TRANSITIONS: Record<InvitationStatus, readonly InvitationStatus[]> = {
  pending: ['accepted', 'rejected', 'revoked', 'expired'],
  accepted: [],
  rejected: [],
  revoked: [],
  expired: [],
};

export type InvitationStatus = 'pending' | 'accepted' | 'rejected' | 'revoked' | 'expired';

export type InvitationFlow = 'person_first' | 'professional_first';

export interface Invitation {
  readonly invitationId: InvitationId;
  readonly flow: InvitationFlow;
  readonly status: InvitationStatus;
  readonly contactPoint: string;
  readonly invitedByProfessionalId: ProfessionalId | null;
  readonly organizationId: OrganizationId | null;
  readonly requestedCategories: readonly string[];
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly consumedAt: number | null;
  readonly claimedPersonId: PersonId | null;
}

export function issueInvitation(input: {
  invitationId: InvitationId;
  flow: InvitationFlow;
  contactPoint: string;
  invitedByProfessionalId: ProfessionalId | null;
  organizationId: OrganizationId | null;
  requestedCategories: readonly string[];
  issuedAt: number;
  ttlMs: number;
}): Invitation {
  if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'Invitation TTL must be positive', {
      entity: 'Invitation',
      reason: 'invalid_ttl',
    });
  }
  return {
    invitationId: input.invitationId,
    flow: input.flow,
    status: 'pending',
    contactPoint: requireNonEmpty('Invitation', 'contactPoint', input.contactPoint),
    invitedByProfessionalId: input.invitedByProfessionalId,
    organizationId: input.organizationId,
    requestedCategories: [...input.requestedCategories],
    issuedAt: input.issuedAt,
    expiresAt: input.issuedAt + input.ttlMs,
    consumedAt: null,
    claimedPersonId: null,
  };
}

export function isInvitationExpired(invitation: Invitation, at: number): boolean {
  return at > invitation.expiresAt;
}

export function expireInvitation(invitation: Invitation, at: number): Invitation {
  if (invitation.status !== 'pending') {
    throw invalidTransition(
      'Invitation',
      'INVALID_INVITATION_TRANSITION',
      invitation.status,
      'expired',
    );
  }
  if (at <= invitation.expiresAt) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'Not yet expired', {
      entity: 'Invitation',
      reason: 'not_expired',
    });
  }
  return { ...invitation, status: 'expired' };
}

export function revokeInvitation(invitation: Invitation): Invitation {
  const allowed = INVITATION_TRANSITIONS[invitation.status];
  if (!allowed.includes('revoked')) {
    throw invalidTransition(
      'Invitation',
      'INVALID_INVITATION_TRANSITION',
      invitation.status,
      'revoked',
    );
  }
  return { ...invitation, status: 'revoked' };
}

export function rejectInvitation(invitation: Invitation, at: number): Invitation {
  if (invitation.status !== 'pending') {
    throw invalidTransition(
      'Invitation',
      'INVALID_INVITATION_TRANSITION',
      invitation.status,
      'rejected',
    );
  }
  if (isInvitationExpired(invitation, at)) {
    throw new DomainError('EXPIRED_INVITATION', 'Invitation already expired', {
      entity: 'Invitation',
      reason: 'expired',
    });
  }
  return { ...invitation, status: 'rejected', consumedAt: at };
}

export function acceptInvitation(input: {
  invitation: Invitation;
  at: number;
  claimedPersonId: PersonId;
}): Invitation {
  const { invitation } = input;
  if (invitation.status === 'accepted') {
    throw new DomainError('REPLAY_ATTEMPT', 'Invitation already consumed', {
      entity: 'Invitation',
      reason: 'replay',
    });
  }
  if (invitation.status !== 'pending') {
    throw invalidTransition(
      'Invitation',
      'INVALID_INVITATION_TRANSITION',
      invitation.status,
      'accepted',
    );
  }
  if (isInvitationExpired(invitation, input.at)) {
    throw new DomainError('EXPIRED_INVITATION', 'Cannot accept expired invitation', {
      entity: 'Invitation',
      reason: 'expired',
    });
  }
  return {
    ...invitation,
    status: 'accepted',
    consumedAt: input.at,
    claimedPersonId: input.claimedPersonId,
  };
}
