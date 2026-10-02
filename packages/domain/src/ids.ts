import { invalidValue } from './errors.js';

function requireId<T extends string>(entity: string, value: string): T {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw invalidValue(entity, 'identifier must be a non-empty string');
  }
  return trimmed as T;
}

export type PersonId = string & {
  readonly __brand: 'PersonId';
};

export type ProfessionalId = string & {
  readonly __brand: 'ProfessionalId';
};

export type OrganizationId = string & {
  readonly __brand: 'OrganizationId';
};

export type CareTeamId = string & {
  readonly __brand: 'CareTeamId';
};

export type CareTeamMembershipId = string & {
  readonly __brand: 'CareTeamMembershipId';
};

export type OrganizationMembershipId = string & {
  readonly __brand: 'OrganizationMembershipId';
};

export type ConsentId = string & {
  readonly __brand: 'ConsentId';
};

export type ConsentRevisionId = string & {
  readonly __brand: 'ConsentRevisionId';
};

export type AccessGrantId = string & {
  readonly __brand: 'AccessGrantId';
};

export type AccessRequestId = string & {
  readonly __brand: 'AccessRequestId';
};

export type AssessmentId = string & {
  readonly __brand: 'AssessmentId';
};

export type GoalId = string & {
  readonly __brand: 'GoalId';
};

export type CarePlanId = string & {
  readonly __brand: 'CarePlanId';
};

export type InterventionId = string & {
  readonly __brand: 'InterventionId';
};

export type OutcomeId = string & {
  readonly __brand: 'OutcomeId';
};

export type ObservationId = string & {
  readonly __brand: 'ObservationId';
};

export type DocumentId = string & {
  readonly __brand: 'DocumentId';
};

export type HandoffId = string & {
  readonly __brand: 'HandoffId';
};

export type InvitationId = string & {
  readonly __brand: 'InvitationId';
};

export type PrivateProfessionalNoteId = string & {
  readonly __brand: 'PrivateProfessionalNoteId';
};

export type ProfessionalRoleId = string & {
  readonly __brand: 'ProfessionalRoleId';
};

export type RelationshipId = string & {
  readonly __brand: 'RelationshipId';
};

export function personId(value: string): PersonId {
  return requireId('PersonId', value);
}

export function professionalId(value: string): ProfessionalId {
  return requireId('ProfessionalId', value);
}

export function organizationId(value: string): OrganizationId {
  return requireId('OrganizationId', value);
}

export function careTeamId(value: string): CareTeamId {
  return requireId('CareTeamId', value);
}

export function careTeamMembershipId(value: string): CareTeamMembershipId {
  return requireId('CareTeamMembershipId', value);
}

export function organizationMembershipId(value: string): OrganizationMembershipId {
  return requireId('OrganizationMembershipId', value);
}

export function consentId(value: string): ConsentId {
  return requireId('ConsentId', value);
}

export function consentRevisionId(value: string): ConsentRevisionId {
  return requireId('ConsentRevisionId', value);
}

export function accessGrantId(value: string): AccessGrantId {
  return requireId('AccessGrantId', value);
}

export function accessRequestId(value: string): AccessRequestId {
  return requireId('AccessRequestId', value);
}

export function assessmentId(value: string): AssessmentId {
  return requireId('AssessmentId', value);
}

export function goalId(value: string): GoalId {
  return requireId('GoalId', value);
}

export function carePlanId(value: string): CarePlanId {
  return requireId('CarePlanId', value);
}

export function interventionId(value: string): InterventionId {
  return requireId('InterventionId', value);
}

export function outcomeId(value: string): OutcomeId {
  return requireId('OutcomeId', value);
}

export function observationId(value: string): ObservationId {
  return requireId('ObservationId', value);
}

export function documentId(value: string): DocumentId {
  return requireId('DocumentId', value);
}

export function handoffId(value: string): HandoffId {
  return requireId('HandoffId', value);
}

export function invitationId(value: string): InvitationId {
  return requireId('InvitationId', value);
}

export function privateProfessionalNoteId(value: string): PrivateProfessionalNoteId {
  return requireId('PrivateProfessionalNoteId', value);
}

export function professionalRoleId(value: string): ProfessionalRoleId {
  return requireId('ProfessionalRoleId', value);
}

export function relationshipId(value: string): RelationshipId {
  return requireId('RelationshipId', value);
}
