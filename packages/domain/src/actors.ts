import { DomainError } from './errors.js';
import { requireNonEmpty } from './primitives.js';
import type {
  CareTeamId,
  CareTeamMembershipId,
  OrganizationId,
  OrganizationMembershipId,
  PersonId,
  ProfessionalId,
  ProfessionalRoleId,
} from './ids.js';

export interface Person {
  readonly personId: PersonId;
  readonly displayName: string;
  readonly isAdult: boolean;
  readonly createdAt: number;
}

export function createPerson(input: {
  personId: PersonId;
  displayName: string;
  isAdult: boolean;
  createdAt: number;
}): Person {
  return {
    personId: input.personId,
    displayName: requireNonEmpty('Person', 'displayName', input.displayName),
    isAdult: input.isAdult,
    createdAt: input.createdAt,
  };
}

export interface ProfessionalRole {
  readonly roleId: ProfessionalRoleId;
  readonly title: string;
  readonly organizationId: OrganizationId;
}

export function createProfessionalRole(input: {
  roleId: ProfessionalRoleId;
  title: string;
  organizationId: OrganizationId;
}): ProfessionalRole {
  return {
    roleId: input.roleId,
    title: requireNonEmpty('ProfessionalRole', 'title', input.title),
    organizationId: input.organizationId,
  };
}

export interface Professional {
  readonly professionalId: ProfessionalId;
  readonly displayName: string;
  readonly roles: readonly ProfessionalRole[];
}

export function createProfessional(input: {
  professionalId: ProfessionalId;
  displayName: string;
  roles?: readonly ProfessionalRole[];
}): Professional {
  return {
    professionalId: input.professionalId,
    displayName: requireNonEmpty('Professional', 'displayName', input.displayName),
    roles: input.roles ? [...input.roles] : [],
  };
}

export interface Organization {
  readonly organizationId: OrganizationId;
  readonly name: string;
}

export function createOrganization(input: {
  organizationId: OrganizationId;
  name: string;
}): Organization {
  return {
    organizationId: input.organizationId,
    name: requireNonEmpty('Organization', 'name', input.name),
  };
}

export type OrganizationMembershipStatus = 'invited' | 'active' | 'ended';

/**
 * Ops tenancy only. Never appears in health-read policy predicates (contract I-3).
 */
export interface OrganizationMembership {
  readonly membershipId: OrganizationMembershipId;
  readonly organizationId: OrganizationId;
  readonly professionalId: ProfessionalId;
  readonly status: OrganizationMembershipStatus;
}

export function createOrganizationMembership(input: {
  membershipId: OrganizationMembershipId;
  organizationId: OrganizationId;
  professionalId: ProfessionalId;
}): OrganizationMembership {
  return {
    membershipId: input.membershipId,
    organizationId: input.organizationId,
    professionalId: input.professionalId,
    status: 'active',
  };
}

export function endOrganizationMembership(
  membership: OrganizationMembership,
): OrganizationMembership {
  if (membership.status === 'ended') {
    return membership;
  }
  return { ...membership, status: 'ended' };
}

export interface CareTeam {
  readonly careTeamId: CareTeamId;
  readonly personId: PersonId;
  readonly createdAt: number;
}

export function createCareTeam(input: {
  careTeamId: CareTeamId;
  personId: PersonId;
  createdAt: number;
}): CareTeam {
  return {
    careTeamId: input.careTeamId,
    personId: input.personId,
    createdAt: input.createdAt,
  };
}

export type CareTeamMembershipStatus = 'active' | 'ended';

/**
 * Necessary for health access, never sufficient without consent (contract formula).
 */
export interface CareTeamMembership {
  readonly membershipId: CareTeamMembershipId;
  readonly careTeamId: CareTeamId;
  readonly personId: PersonId;
  readonly professionalId: ProfessionalId;
  readonly status: CareTeamMembershipStatus;
  readonly joinedAt: number;
  readonly endedAt: number | null;
}

export function addCareTeamMembership(input: {
  membershipId: CareTeamMembershipId;
  careTeamId: CareTeamId;
  personId: PersonId;
  professionalId: ProfessionalId;
  joinedAt: number;
}): CareTeamMembership {
  return {
    membershipId: input.membershipId,
    careTeamId: input.careTeamId,
    personId: input.personId,
    professionalId: input.professionalId,
    status: 'active',
    joinedAt: input.joinedAt,
    endedAt: null,
  };
}

export function endCareTeamMembership(
  membership: CareTeamMembership,
  endedAt: number,
): CareTeamMembership {
  if (membership.status === 'ended') {
    return membership;
  }
  if (endedAt < membership.joinedAt) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'endedAt before joinedAt', {
      entity: 'CareTeamMembership',
      reason: 'time_order',
    });
  }
  return { ...membership, status: 'ended', endedAt };
}

export function isActiveMembership(membership: CareTeamMembership): boolean {
  return membership.status === 'active';
}
