import { DomainError, invalidTransition } from './errors.js';
import { requireNonEmpty } from './primitives.js';
import type { HandoffId, PersonId, PrivateProfessionalNoteId, ProfessionalId } from './ids.js';

const HANDOFF_TRANSITIONS: Record<HandoffStatus, readonly HandoffStatus[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['acknowledged', 'cancelled'],
  acknowledged: ['closed'],
  closed: [],
  cancelled: [],
};
function assertNoPrivateNoteMarkers(manifest: HandoffManifest): void {
  for (const entry of manifest) {
    if (entry.refId.startsWith('ppn:')) {
      throw new DomainError(
        'PRIVATE_NOTE_CANNOT_BE_SHARED',
        'Private professional notes cannot appear in handoff manifests',
        { entity: 'Handoff', reason: 'private_note_in_manifest' },
      );
    }
  }
}
function assertTransition(handoff: Handoff, to: HandoffStatus): void {
  const allowed = HANDOFF_TRANSITIONS[handoff.status];
  if (!allowed.includes(to)) {
    throw invalidTransition('Handoff', 'INVALID_HANDOFF_TRANSITION', handoff.status, to);
  }
}

export type HandoffStatus = 'draft' | 'sent' | 'acknowledged' | 'closed' | 'cancelled';

export interface HandoffManifestEntry {
  readonly refKind: 'assessment' | 'goal' | 'care_plan' | 'intervention' | 'outcome' | 'document';
  readonly refId: string;
}

export type HandoffManifest = readonly HandoffManifestEntry[];

export interface Handoff {
  readonly handoffId: HandoffId;
  readonly personId: PersonId;
  readonly senderProfessionalId: ProfessionalId;
  readonly receiverProfessionalId: ProfessionalId;
  readonly status: HandoffStatus;
  readonly summary: string;
  readonly manifest: HandoffManifest;
  readonly sentAt: number | null;
  readonly acknowledgedAt: number | null;
  readonly closedAt: number | null;
}

export function assertManifestExcludesPrivateNotes(
  manifest: HandoffManifest,
  privateNoteIds: readonly PrivateProfessionalNoteId[],
): void {
  const noteSet = new Set<string>(privateNoteIds);
  for (const entry of manifest) {
    if (noteSet.has(entry.refId) || entry.refId.startsWith('ppn:')) {
      throw new DomainError(
        'PRIVATE_NOTE_CANNOT_BE_SHARED',
        'Private professional note identifiers cannot be part of a handoff manifest',
        { entity: 'Handoff', reason: 'private_note_in_manifest' },
      );
    }
  }
}

export function createHandoff(input: {
  handoffId: HandoffId;
  personId: PersonId;
  senderProfessionalId: ProfessionalId;
  receiverProfessionalId: ProfessionalId;
  summary: string;
  manifest: HandoffManifest;
  privateNoteIds?: readonly PrivateProfessionalNoteId[];
}): Handoff {
  const notes = input.privateNoteIds ?? [];
  assertManifestExcludesPrivateNotes(input.manifest, notes);
  assertNoPrivateNoteMarkers(input.manifest);
  if (input.senderProfessionalId === input.receiverProfessionalId) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'Sender and receiver must differ', {
      entity: 'Handoff',
      reason: 'same_parties',
    });
  }
  return {
    handoffId: input.handoffId,
    personId: input.personId,
    senderProfessionalId: input.senderProfessionalId,
    receiverProfessionalId: input.receiverProfessionalId,
    status: 'draft',
    summary: requireNonEmpty('Handoff', 'summary', input.summary),
    manifest: [...input.manifest],
    sentAt: null,
    acknowledgedAt: null,
    closedAt: null,
  };
}

export function updateHandoffDraft(
  handoff: Handoff,
  input: {
    summary?: string;
    manifest?: HandoffManifest;
    privateNoteIds?: readonly PrivateProfessionalNoteId[];
  },
): Handoff {
  if (handoff.status !== 'draft') {
    throw new DomainError('HANDOFF_MANIFEST_LOCKED', 'Handoff cannot change after send', {
      entity: 'Handoff',
      reason: handoff.status,
    });
  }
  const manifest = input.manifest ?? handoff.manifest;
  assertManifestExcludesPrivateNotes(manifest, input.privateNoteIds ?? []);
  return {
    ...handoff,
    summary:
      input.summary === undefined
        ? handoff.summary
        : requireNonEmpty('Handoff', 'summary', input.summary),
    manifest: [...manifest],
  };
}

export function sendHandoff(handoff: Handoff, sentAt: number): Handoff {
  assertTransition(handoff, 'sent');
  if (handoff.manifest.length === 0) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'Cannot send handoff with empty manifest', {
      entity: 'Handoff',
      reason: 'empty_manifest',
    });
  }
  return { ...handoff, status: 'sent', sentAt };
}

export function acknowledgeHandoff(handoff: Handoff, acknowledgedAt: number): Handoff {
  assertTransition(handoff, 'acknowledged');
  if (handoff.sentAt === null || acknowledgedAt < handoff.sentAt) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'acknowledgedAt before sentAt', {
      entity: 'Handoff',
      reason: 'time_order',
    });
  }
  return { ...handoff, status: 'acknowledged', acknowledgedAt };
}

export function closeHandoff(handoff: Handoff, closedAt: number): Handoff {
  assertTransition(handoff, 'closed');
  if (handoff.acknowledgedAt === null || closedAt < handoff.acknowledgedAt) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'closedAt before acknowledgedAt', {
      entity: 'Handoff',
      reason: 'time_order',
    });
  }
  return { ...handoff, status: 'closed', closedAt };
}

export function cancelHandoff(handoff: Handoff): Handoff {
  assertTransition(handoff, 'cancelled');
  return { ...handoff, status: 'cancelled' };
}
