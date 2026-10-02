/**
 * Row → domain mappers. Persistence translates DB rows into domain types;
 * domain never imports pg types.
 */

import {
  assessmentId,
  carePlanId,
  createAssessment,
  createPrivateNote,
  personId,
  privateProfessionalNoteId,
  professionalId,
} from '@health-os/domain';
import type { Assessment, PrivateProfessionalNote } from '@health-os/domain';

export interface AssessmentRow {
  readonly assessment_id: string;
  readonly person_id: string;
  readonly author_professional_id: string;
  readonly status: string;
  readonly title: string;
  readonly body: string;
  readonly version: number;
  readonly predecessor_assessment_id: string | null;
  readonly signed_at: Date | null;
  readonly signed_by_professional_id: string | null;
  readonly amended_at: Date | null;
  readonly created_at: Date;
}

export interface PrivateNoteRow {
  readonly note_id: string;
  readonly person_id: string;
  readonly author_professional_id: string;
  readonly status: string;
  readonly data_class: string;
  readonly body: string;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly voided_at: Date | null;
}

export function mapAssessmentRow(row: AssessmentRow): Assessment {
  const base = createAssessment({
    assessmentId: assessmentId(row.assessment_id),
    personId: personId(row.person_id),
    authorProfessionalId: professionalId(row.author_professional_id),
    content: { title: row.title, body: row.body },
    createdAt: row.created_at.getTime(),
  });
  if (row.status === 'draft') {
    return base;
  }
  if (row.status === 'signed') {
    if (row.signed_at === null || row.signed_by_professional_id === null) {
      throw new Error('signed assessment missing signature metadata');
    }
    return {
      ...base,
      status: 'signed',
      signedAt: row.signed_at.getTime(),
      signedByProfessionalId: professionalId(row.signed_by_professional_id),
    };
  }
  if (row.status === 'amended') {
    if (
      row.signed_at === null ||
      row.signed_by_professional_id === null ||
      row.amended_at === null
    ) {
      throw new Error('amended assessment missing signature/amendment metadata');
    }
    return {
      ...base,
      status: 'amended',
      signedAt: row.signed_at.getTime(),
      signedByProfessionalId: professionalId(row.signed_by_professional_id),
      amendedAt: row.amended_at.getTime(),
    };
  }
  throw new Error(`unknown assessment status: ${row.status}`);
}

export function mapPrivateNoteRow(row: PrivateNoteRow): PrivateProfessionalNote {
  const created = createPrivateNote({
    noteId: privateProfessionalNoteId(row.note_id),
    personId: personId(row.person_id),
    authorProfessionalId: professionalId(row.author_professional_id),
    body: row.body,
    createdAt: row.created_at.getTime(),
  });
  if (row.status === 'active') {
    return created;
  }
  if (row.status !== 'voided' || row.voided_at === null) {
    throw new Error(`invalid private note row status: ${row.status}`);
  }
  return {
    ...created,
    status: 'voided',
    updatedAt: row.updated_at.getTime(),
    voidedAt: row.voided_at.getTime(),
  };
}

export function mapPersonId(raw: string): ReturnType<typeof personId> {
  return personId(raw);
}

export function mapCarePlanId(raw: string): ReturnType<typeof carePlanId> {
  return carePlanId(raw);
}
