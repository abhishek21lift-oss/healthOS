import { invalidValue } from './errors.js';

function requireId(entity: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw invalidValue(entity, 'identifier must be a non-empty string');
  }
  return trimmed;
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
  return requireId('PersonId', value) as PersonId;
}

export function professionalId(value: string): ProfessionalId {
  return requireId('ProfessionalId', value) as ProfessionalId;
}

export function organizationId(value: string): OrganizationId {
  return requireId('OrganizationId', value) as OrganizationId;
}

export function careTeamId(value: string): CareTeamId {
  return requireId('CareTeamId', value) as CareTeamId;
}

export function careTeamMembershipId(value: string): CareTeamMembershipId {
  return requireId('CareTeamMembershipId', value) as CareTeamMembershipId;
}

export function organizationMembershipId(value: string): OrganizationMembershipId {
  return requireId('OrganizationMembershipId', value) as OrganizationMembershipId;
}

export function consentId(value: string): ConsentId {
  return requireId('ConsentId', value) as ConsentId;
}

export function consentRevisionId(value: string): ConsentRevisionId {
  return requireId('ConsentRevisionId', value) as ConsentRevisionId;
}

export function accessGrantId(value: string): AccessGrantId {
  return requireId('AccessGrantId', value) as AccessGrantId;
}

export function accessRequestId(value: string): AccessRequestId {
  return requireId('AccessRequestId', value) as AccessRequestId;
}

export function assessmentId(value: string): AssessmentId {
  return requireId('AssessmentId', value) as AssessmentId;
}

export function goalId(value: string): GoalId {
  return requireId('GoalId', value) as GoalId;
}

export function carePlanId(value: string): CarePlanId {
  return requireId('CarePlanId', value) as CarePlanId;
}

export function interventionId(value: string): InterventionId {
  return requireId('InterventionId', value) as InterventionId;
}

export function outcomeId(value: string): OutcomeId {
  return requireId('OutcomeId', value) as OutcomeId;
}

export function observationId(value: string): ObservationId {
  return requireId('ObservationId', value) as ObservationId;
}

export function documentId(value: string): DocumentId {
  return requireId('DocumentId', value) as DocumentId;
}

export function handoffId(value: string): HandoffId {
  return requireId('HandoffId', value) as HandoffId;
}

export function invitationId(value: string): InvitationId {
  return requireId('InvitationId', value) as InvitationId;
}

export function privateProfessionalNoteId(value: string): PrivateProfessionalNoteId {
  return requireId('PrivateProfessionalNoteId', value) as PrivateProfessionalNoteId;
}

export function professionalRoleId(value: string): ProfessionalRoleId {
  return requireId('ProfessionalRoleId', value) as ProfessionalRoleId;
}

export function relationshipId(value: string): RelationshipId {
  return requireId('RelationshipId', value) as RelationshipId;
}
