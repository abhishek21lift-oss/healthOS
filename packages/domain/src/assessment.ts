import { DomainError, invalidTransition } from './errors.js';
import { isMachine, requireNonEmpty } from './primitives.js';
import type { AssessmentId, PersonId, ProfessionalId } from './ids.js';
import type { Actor } from './primitives.js';

function requireDraft(assessment: Assessment, action: string): void {
  if (assessment.status !== 'draft') {
    throw invalidTransition(
      'Assessment',
      'INVALID_ASSESSMENT_TRANSITION',
      assessment.status,
      action,
      'draft_only',
    );
  }
}

export type AssessmentStatus = 'draft' | 'signed' | 'amended';

export interface AssessmentContent {
  readonly title: string;
  readonly body: string;
}

export interface Assessment {
  readonly assessmentId: AssessmentId;
  readonly personId: PersonId;
  readonly authorProfessionalId: ProfessionalId;
  readonly status: AssessmentStatus;
  readonly content: AssessmentContent;
  readonly version: number;
  readonly predecessorAssessmentId: AssessmentId | null;
  readonly signedAt: number | null;
  readonly signedByProfessionalId: ProfessionalId | null;
  readonly amendedAt: number | null;
}

export function createAssessment(input: {
  assessmentId: AssessmentId;
  personId: PersonId;
  authorProfessionalId: ProfessionalId;
  content: AssessmentContent;
  createdAt: number;
}): Assessment {
  return {
    assessmentId: input.assessmentId,
    personId: input.personId,
    authorProfessionalId: input.authorProfessionalId,
    status: 'draft',
    content: {
      title: requireNonEmpty('Assessment', 'title', input.content.title),
      body: input.content.body,
    },
    version: 1,
    predecessorAssessmentId: null,
    signedAt: null,
    signedByProfessionalId: null,
    amendedAt: null,
  };
}

export function updateAssessmentDraft(
  assessment: Assessment,
  content: AssessmentContent,
): Assessment {
  requireDraft(assessment, 'edit');
  return {
    ...assessment,
    content: {
      title: requireNonEmpty('Assessment', 'title', content.title),
      body: content.body,
    },
  };
}

export function signAssessment(input: {
  assessment: Assessment;
  signer: Actor;
  signerProfessionalId: ProfessionalId;
  signedAt: number;
}): Assessment {
  const { assessment, signer } = input;
  if (isMachine(signer)) {
    throw new DomainError('MACHINE_ACTOR_FORBIDDEN', 'Machine/AI actors cannot sign assessments', {
      entity: 'Assessment',
      reason: 'ai_sign_forbidden',
    });
  }
  if (signer.kind !== 'human_professional') {
    throw new DomainError('MACHINE_ACTOR_FORBIDDEN', 'Only professionals may sign', {
      entity: 'Assessment',
      reason: 'signer_not_professional',
    });
  }
  if (assessment.status === 'signed') {
    throw invalidTransition(
      'Assessment',
      'INVALID_ASSESSMENT_TRANSITION',
      'signed',
      'signed',
      'already_signed',
    );
  }
  requireDraft(assessment, 'sign');
  if (input.signedAt < 0) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'signedAt must be non-negative', {
      entity: 'Assessment',
    });
  }
  return {
    ...assessment,
    status: 'signed',
    signedAt: input.signedAt,
    signedByProfessionalId: input.signerProfessionalId,
  };
}

export function amendAssessment(input: {
  signedAssessment: Assessment;
  successorAssessmentId: AssessmentId;
  revisedContent: AssessmentContent;
  amendedByProfessionalId: ProfessionalId;
  amendedAt: number;
}): {
  readonly predecessor: Assessment;
  readonly successor: Assessment;
} {
  const { signedAssessment } = input;
  if (signedAssessment.status === 'draft') {
    throw invalidTransition(
      'Assessment',
      'INVALID_ASSESSMENT_TRANSITION',
      'draft',
      'amended',
      'must_sign_first',
    );
  }
  if (signedAssessment.status === 'amended') {
    throw invalidTransition(
      'Assessment',
      'INVALID_ASSESSMENT_TRANSITION',
      'amended',
      'amended',
      'already_amended',
    );
  }
  if (signedAssessment.signedByProfessionalId === null || signedAssessment.signedAt === null) {
    throw new DomainError('INVALID_ASSESSMENT_TRANSITION', 'Missing signature metadata', {
      entity: 'Assessment',
      reason: 'unsigned',
    });
  }
  if (input.amendedAt < signedAssessment.signedAt) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'amendedAt before signedAt', {
      entity: 'Assessment',
      reason: 'time_order',
    });
  }
  const predecessor: Assessment = {
    ...signedAssessment,
    status: 'amended',
    amendedAt: input.amendedAt,
  };
  const successor: Assessment = {
    assessmentId: input.successorAssessmentId,
    personId: signedAssessment.personId,
    authorProfessionalId: input.amendedByProfessionalId,
    status: 'draft',
    content: {
      title: requireNonEmpty('Assessment', 'title', input.revisedContent.title),
      body: input.revisedContent.body,
    },
    version: signedAssessment.version + 1,
    predecessorAssessmentId: signedAssessment.assessmentId,
    signedAt: null,
    signedByProfessionalId: null,
    amendedAt: null,
  };
  return { predecessor, successor };
}

export function assertAssessmentContentFrozen(assessment: Assessment): void {
  if (assessment.status !== 'draft') {
    throw new DomainError(
      'ASSESSMENT_CONTENT_IMMUTABLE',
      `Assessment content is immutable in status ${assessment.status}`,
      { entity: 'Assessment', reason: assessment.status },
    );
  }
}
