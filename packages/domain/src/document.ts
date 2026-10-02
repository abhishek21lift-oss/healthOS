import { DomainError, invalidTransition } from './errors.js';
import { requireNonEmpty } from './primitives.js';
import type { DocumentId, PersonId, ProfessionalId } from './ids.js';
import type { DataClass } from './primitives.js';

const DOCUMENT_TRANSITIONS: Record<DocumentStatus, readonly DocumentStatus[]> = {
  initialized: ['pending_scan'],
  pending_scan: ['available', 'quarantined', 'failed'],
  available: [],
  quarantined: [],
  failed: ['pending_scan'],
};

export type DocumentStatus =
  'initialized' | 'pending_scan' | 'available' | 'quarantined' | 'failed';

export type DocumentScanStatus = 'pending' | 'clean' | 'malicious' | 'error';

export interface Document {
  readonly documentId: DocumentId;
  readonly personId: PersonId;
  readonly title: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly dataClass: DataClass;
  readonly status: DocumentStatus;
  readonly scanStatus: DocumentScanStatus;
  readonly storageKey: string;
  readonly checksumSha256: string;
  readonly createdByProfessionalId: ProfessionalId;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export function createDocument(input: {
  documentId: DocumentId;
  personId: PersonId;
  title: string;
  contentType: string;
  byteSize: number;
  dataClass: DataClass;
  storageKey: string;
  checksumSha256: string;
  createdByProfessionalId: ProfessionalId;
  createdAt: number;
}): Document {
  if (input.byteSize < 0) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'byteSize must be non-negative', {
      entity: 'Document',
      reason: 'byte_size',
    });
  }
  if (!/^[0-9a-f]{64}$/i.test(input.checksumSha256)) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'checksumSha256 must be sha-256 hex', {
      entity: 'Document',
      reason: 'checksum',
    });
  }
  return {
    documentId: input.documentId,
    personId: input.personId,
    title: requireNonEmpty('Document', 'title', input.title),
    contentType: requireNonEmpty('Document', 'contentType', input.contentType),
    byteSize: input.byteSize,
    dataClass: input.dataClass,
    status: 'initialized',
    scanStatus: 'pending',
    storageKey: requireNonEmpty('Document', 'storageKey', input.storageKey),
    checksumSha256: input.checksumSha256.toLowerCase(),
    createdByProfessionalId: input.createdByProfessionalId,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

export function transitionDocument(
  document: Document,
  to: DocumentStatus,
  input: {
    at: number;
    scanStatus?: DocumentScanStatus;
  },
): Document {
  const allowed = DOCUMENT_TRANSITIONS[document.status];
  if (!allowed.includes(to)) {
    throw invalidTransition('Document', 'INVALID_DOCUMENT_TRANSITION', document.status, to);
  }
  let scanStatus = document.scanStatus;
  if (to === 'pending_scan') {
    scanStatus = 'pending';
  } else if (to === 'available') {
    scanStatus = input.scanStatus ?? 'clean';
    if (scanStatus !== 'clean') {
      throw new DomainError('INVALID_DOCUMENT_TRANSITION', 'available requires clean scan', {
        entity: 'Document',
        reason: 'scan_not_clean',
      });
    }
  } else if (to === 'quarantined') {
    scanStatus = 'malicious';
  } else if (to === 'failed') {
    scanStatus = input.scanStatus ?? 'error';
  }
  if (input.at < document.updatedAt) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'at before updatedAt', {
      entity: 'Document',
      reason: 'time_order',
    });
  }
  return { ...document, status: to, scanStatus, updatedAt: input.at };
}

export function assertDocumentReadable(document: Document): void {
  if (document.status !== 'available') {
    throw new DomainError('DOCUMENT_NOT_AVAILABLE', `Document status ${document.status}`, {
      entity: 'Document',
      reason: document.status,
    });
  }
}

export function isHighSensitivity(document: Document): boolean {
  return document.dataClass === 'HIGH_SENSITIVITY';
}
