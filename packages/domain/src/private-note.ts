import { DomainError, invalidTransition } from './errors.js';
import { requireNonEmpty } from './primitives.js';
import type { PersonId, PrivateProfessionalNoteId, ProfessionalId } from './ids.js';
import type { DataClass } from './primitives.js';

export type PrivateNoteStatus = 'active' | 'voided';

export const PRIVATE_NOTE_DATA_CLASS: 'PROFESSIONAL_PRIVATE' = 'PROFESSIONAL_PRIVATE';

export interface PrivateProfessionalNote {
  readonly noteId: PrivateProfessionalNoteId;
  readonly personId: PersonId;
  readonly authorProfessionalId: ProfessionalId;
  readonly status: PrivateNoteStatus;
  readonly dataClass: DataClass;
  readonly body: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly voidedAt: number | null;
}

export interface PromotedNoteCopy {
  readonly sourceNoteId: PrivateProfessionalNoteId;
  readonly personId: PersonId;
  readonly promotedByProfessionalId: ProfessionalId;
  readonly body: string;
  readonly promotedAt: number;
  readonly provenance: 'promotion_from_private_note';
}

export function createPrivateNote(input: {
  noteId: PrivateProfessionalNoteId;
  personId: PersonId;
  authorProfessionalId: ProfessionalId;
  body: string;
  createdAt: number;
}): PrivateProfessionalNote {
  return {
    noteId: input.noteId,
    personId: input.personId,
    authorProfessionalId: input.authorProfessionalId,
    status: 'active',
    dataClass: PRIVATE_NOTE_DATA_CLASS,
    body: requireNonEmpty('PrivateProfessionalNote', 'body', input.body),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    voidedAt: null,
  };
}

export function updatePrivateNote(
  note: PrivateProfessionalNote,
  input: {
    body: string;
    actorProfessionalId: ProfessionalId;
    at: number;
  },
): PrivateProfessionalNote {
  if (note.status !== 'active') {
    throw invalidTransition(
      'PrivateProfessionalNote',
      'INVALID_PRIVATE_NOTE_TRANSITION',
      note.status,
      'active',
      'edit_forbidden',
    );
  }
  if (input.actorProfessionalId !== note.authorProfessionalId) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'Only the author may edit', {
      entity: 'PrivateProfessionalNote',
      reason: 'not_author',
    });
  }
  if (input.at < note.updatedAt) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'at before updatedAt', {
      entity: 'PrivateProfessionalNote',
      reason: 'time_order',
    });
  }
  return {
    ...note,
    body: requireNonEmpty('PrivateProfessionalNote', 'body', input.body),
    updatedAt: input.at,
  };
}

export function voidPrivateNote(
  note: PrivateProfessionalNote,
  input: {
    actorProfessionalId: ProfessionalId;
    at: number;
  },
): PrivateProfessionalNote {
  if (note.status === 'voided') {
    throw invalidTransition(
      'PrivateProfessionalNote',
      'INVALID_PRIVATE_NOTE_TRANSITION',
      'voided',
      'voided',
      'already_voided',
    );
  }
  if (input.actorProfessionalId !== note.authorProfessionalId) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'Only the author may void', {
      entity: 'PrivateProfessionalNote',
      reason: 'not_author',
    });
  }
  return { ...note, status: 'voided', voidedAt: input.at, updatedAt: input.at };
}

/**
 * Explicit promotion: creates a shared copy with new provenance.
 * Original note is unchanged and remains PROFESSIONAL_PRIVATE.
 */
export function promotePrivateNote(
  note: PrivateProfessionalNote,
  input: {
    actorProfessionalId: ProfessionalId;
    at: number;
  },
): PromotedNoteCopy {
  if (note.status !== 'active') {
    throw new DomainError('INVALID_PROMOTION', 'Cannot promote a non-active note', {
      entity: 'PrivateProfessionalNote',
      reason: note.status,
    });
  }
  if (input.actorProfessionalId !== note.authorProfessionalId) {
    throw new DomainError('INVALID_PROMOTION', 'Only the author may promote', {
      entity: 'PrivateProfessionalNote',
      reason: 'not_author',
    });
  }
  return {
    sourceNoteId: note.noteId,
    personId: note.personId,
    promotedByProfessionalId: input.actorProfessionalId,
    body: note.body,
    promotedAt: input.at,
    provenance: 'promotion_from_private_note',
  };
}

/**
 * By contract, PROFESSIONAL_PRIVATE notes are never shareable by default (ADR-0005).
 * Explicit promotion is the only cross-professional exposure path.
 */
export function isShareableByDefault(note: PrivateProfessionalNote): boolean {
  return note.dataClass !== PRIVATE_NOTE_DATA_CLASS;
}
