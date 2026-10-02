import { DomainError, invalidTransition } from './errors.js';
import { requireNonEmpty } from './primitives.js';
import type { OrganizationMembershipStatus } from './actors.js';
import type {
  CareTeamId,
  CareTeamMembershipId,
  OrganizationId,
  OrganizationMembershipId,
  PersonId,
  ProfessionalId,
  RelationshipId,
} from './ids.js';

const ORG_MEMBERSHIP_TRANSITIONS: Record<
  OrganizationMembershipStatus,
  readonly OrganizationMembershipStatus[]
> = {
  invited: ['active', 'ended'],
  active: ['ended'],
  ended: [],
};
const COLLAB_EVENT_TYPES = new Set([
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
]);

export type OrganizationStatus = 'active' | 'inactive';

export type OrganizationRole = 'owner' | 'admin' | 'manager' | 'staff';

export type RelationshipStatus = 'active' | 'ended';

export type CareTeamStatus = 'open' | 'closed';

export const ORGANIZATION_ROLES: readonly ['owner', 'admin', 'manager', 'staff'] = [
  'owner',
  'admin',
  'manager',
  'staff',
];

export const ADMIN_ORGANIZATION_ROLES: readonly OrganizationRole[] = ['owner', 'admin'];

export function isOrganizationRole(value: string): value is OrganizationRole {
  return (ORGANIZATION_ROLES as readonly string[]).includes(value);
}

export function isOrganizationAdminRole(role: OrganizationRole): boolean {
  return ADMIN_ORGANIZATION_ROLES.includes(role);
}

export interface CollaborationOrganization {
  readonly organizationId: OrganizationId;
  readonly name: string;
  readonly status: OrganizationStatus;
  readonly createdByProfessionalId: ProfessionalId | null;
}

export function createCollaborationOrganization(input: {
  organizationId: OrganizationId;
  name: string;
  createdByProfessionalId: ProfessionalId | null;
}): CollaborationOrganization {
  return {
    organizationId: input.organizationId,
    name: requireNonEmpty('Organization', 'name', input.name),
    status: 'active',
    createdByProfessionalId: input.createdByProfessionalId,
  };
}

export function deactivateOrganization(org: CollaborationOrganization): CollaborationOrganization {
  if (org.status === 'inactive') {
    throw new DomainError('INVALID_STATE_TRANSITION', 'Organization already inactive', {
      entity: 'Organization',
      from: org.status,
      to: 'inactive',
    });
  }
  return { ...org, status: 'inactive' };
}

export function reactivateOrganization(org: CollaborationOrganization): CollaborationOrganization {
  if (org.status === 'active') {
    throw new DomainError('INVALID_STATE_TRANSITION', 'Organization already active', {
      entity: 'Organization',
      from: org.status,
      to: 'active',
    });
  }
  return { ...org, status: 'active' };
}

export interface CollaborationOrganizationMembership {
  readonly membershipId: OrganizationMembershipId;
  readonly organizationId: OrganizationId;
  readonly professionalId: ProfessionalId;
  readonly role: OrganizationRole;
  readonly status: OrganizationMembershipStatus;
  readonly invitedAt: number | null;
  readonly endedAt: number | null;
}

export function inviteOrganizationMembership(input: {
  membershipId: OrganizationMembershipId;
  organizationId: OrganizationId;
  professionalId: ProfessionalId;
  role: OrganizationRole;
  invitedAt: number;
}): CollaborationOrganizationMembership {
  if (!isOrganizationRole(input.role)) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'Unknown organization role', {
      entity: 'OrganizationMembership',
      reason: 'unknown_role',
    });
  }
  return {
    membershipId: input.membershipId,
    organizationId: input.organizationId,
    professionalId: input.professionalId,
    role: input.role,
    status: 'invited',
    invitedAt: input.invitedAt,
    endedAt: null,
  };
}

export function activateOrganizationMembership(
  membership: CollaborationOrganizationMembership,
): CollaborationOrganizationMembership {
  if (!ORG_MEMBERSHIP_TRANSITIONS[membership.status].includes('active')) {
    throw invalidTransition(
      'OrganizationMembership',
      'INVALID_STATE_TRANSITION',
      membership.status,
      'active',
    );
  }
  return { ...membership, status: 'active' };
}

export function endOrganizationMembershipState(
  membership: CollaborationOrganizationMembership,
  endedAt: number,
): CollaborationOrganizationMembership {
  if (!ORG_MEMBERSHIP_TRANSITIONS[membership.status].includes('ended')) {
    throw invalidTransition(
      'OrganizationMembership',
      'INVALID_STATE_TRANSITION',
      membership.status,
      'ended',
    );
  }
  if (membership.invitedAt !== null && endedAt < membership.invitedAt) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'endedAt before invitedAt', {
      entity: 'OrganizationMembership',
      reason: 'time_order',
    });
  }
  return { ...membership, status: 'ended', endedAt };
}

export function changeOrganizationRole(
  membership: CollaborationOrganizationMembership,
  nextRole: OrganizationRole,
): CollaborationOrganizationMembership {
  if (membership.status === 'ended') {
    throw new DomainError('INVALID_STATE_TRANSITION', 'Cannot change role on ended membership', {
      entity: 'OrganizationMembership',
      from: membership.status,
      to: `role:${nextRole}`,
    });
  }
  if (!isOrganizationRole(nextRole)) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'Unknown organization role', {
      entity: 'OrganizationMembership',
      reason: 'unknown_role',
    });
  }
  if (membership.role === nextRole) {
    return membership;
  }
  return { ...membership, role: nextRole };
}

export interface PersonProfessionalRelationship {
  readonly relationshipId: RelationshipId;
  readonly personId: PersonId;
  readonly professionalId: ProfessionalId;
  readonly careTeamId: CareTeamId | null;
  readonly organizationId: OrganizationId | null;
  readonly collaborationContext: string;
  readonly status: RelationshipStatus;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly createdByInvitationId: string | null;
}

export function startRelationship(input: {
  relationshipId: RelationshipId;
  personId: PersonId;
  professionalId: ProfessionalId;
  careTeamId?: CareTeamId | null;
  organizationId?: OrganizationId | null;
  collaborationContext?: string;
  startedAt: number;
  createdByInvitationId?: string | null;
}): PersonProfessionalRelationship {
  return {
    relationshipId: input.relationshipId,
    personId: input.personId,
    professionalId: input.professionalId,
    careTeamId: input.careTeamId ?? null,
    organizationId: input.organizationId ?? null,
    collaborationContext: requireNonEmpty(
      'Relationship',
      'collaborationContext',
      input.collaborationContext ?? 'care_coordination',
    ),
    status: 'active',
    startedAt: input.startedAt,
    endedAt: null,
    createdByInvitationId: input.createdByInvitationId ?? null,
  };
}

export function endRelationship(
  relationship: PersonProfessionalRelationship,
  endedAt: number,
): PersonProfessionalRelationship {
  if (relationship.status === 'ended') {
    throw invalidTransition('Relationship', 'INVALID_STATE_TRANSITION', 'ended', 'ended');
  }
  if (endedAt < relationship.startedAt) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'endedAt before startedAt', {
      entity: 'Relationship',
      reason: 'time_order',
    });
  }
  return { ...relationship, status: 'ended', endedAt };
}

export type CollaborationAuditEventType =
  | 'organization_created'
  | 'organization_status_changed'
  | 'membership_invited'
  | 'membership_activated'
  | 'membership_ended'
  | 'role_changed'
  | 'care_team_created'
  | 'care_team_closed'
  | 'care_team_member_added'
  | 'care_team_member_removed'
  | 'invitation_created'
  | 'invitation_claimed'
  | 'invitation_rejected'
  | 'invitation_expired'
  | 'invitation_revoked'
  | 'relationship_started'
  | 'relationship_ended';

export function isCollaborationAuditEventType(value: string): value is CollaborationAuditEventType {
  return COLLAB_EVENT_TYPES.has(value);
}

export function assertCollaborationAuditEvent(value: string): CollaborationAuditEventType {
  if (!isCollaborationAuditEventType(value)) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'Unknown collaboration event type', {
      entity: 'CollaborationSecurityEvent',
      reason: 'unknown_event_type',
    });
  }
  return value;
}

export function assertNoTokenInMetadata(metadata: Record<string, unknown>): void {
  for (const key of ['token', 'password', 'session_token', 'health']) {
    if (Object.prototype.hasOwnProperty.call(metadata, key)) {
      throw new DomainError('INVALID_DOMAIN_VALUE', 'Forbidden metadata key', {
        entity: 'CollaborationSecurityEvent',
        reason: key,
      });
    }
  }
}

/** Care team helpers — one open per person is enforced at DB (I-20). */
export function closeCareTeamState(
  status: CareTeamStatus,
  closedAt: number | null,
): {
  readonly status: CareTeamStatus;
  readonly closedAt: number | null;
} {
  if (status === 'closed') {
    throw invalidTransition('CareTeam', 'INVALID_STATE_TRANSITION', 'closed', 'closed');
  }
  if (closedAt === null) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'closedAt required', {
      entity: 'CareTeam',
      reason: 'closed_at_required',
    });
  }
  return { status: 'closed', closedAt };
}

export type { CareTeamMembershipId };
