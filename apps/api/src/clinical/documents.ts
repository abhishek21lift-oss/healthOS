/**
 * Documents service — Phase 6.
 * Metadata + lifecycle only; content via DocumentStorage port.
 * HIGH_SENSITIVITY: server-mediated download only — never returns storage URL/key to clients.
 * No destructive delete (contract).
 */
import { createHash } from 'node:crypto';

import {
  assertDocumentReadable,
  createDocument,
  documentId,
  isHighSensitivity,
  transitionDocument,
  type Document,
} from '@health-os/domain';

import { authorizeClinical, runClinicalAsPrincipal } from './pep.js';
import { queueTimelineProjection } from '../timeline/outbox.js';
import {
  ClinicalError,
  requireProfessional,
  toClinicalError,
  type ClinicalActor,
  type ClinicalDeps,
} from './types.js';

function wrapDomain<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw toClinicalError(error);
  }
}

/** Storage port — implementations must not log bytes or keys with PHI. */
export interface DocumentStorage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** No delete in MVP contract — optional; omit for compliant stores. */
  remove?(key: string): Promise<void>;
}

/** In-memory storage for tests and local dev only (not production). */
export class MemoryDocumentStorage implements DocumentStorage {
  readonly #blobs = new Map<string, Uint8Array>();

  put(key: string, bytes: Uint8Array): Promise<void> {
    this.#blobs.set(key, bytes);
    return Promise.resolve();
  }

  get(key: string): Promise<Uint8Array> {
    const found = this.#blobs.get(key);
    if (found === undefined) {
      return Promise.reject(new ClinicalError('not_found', 'Not found'));
    }
    return Promise.resolve(found);
  }
}

interface DocumentRow {
  document_id: string;
  person_id: string;
  title: string;
  content_type: string;
  byte_size: number;
  data_class: string;
  status: string;
  scan_status: string;
  storage_key: string;
  checksum_sha256: string;
  created_by_professional_id: string;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: DocumentRow): Document {
  return {
    documentId: row.document_id as never,
    personId: row.person_id as never,
    title: row.title,
    contentType: row.content_type,
    byteSize: row.byte_size,
    dataClass: row.data_class as Document['dataClass'],
    status: row.status as Document['status'],
    scanStatus: row.scan_status as Document['scanStatus'],
    storageKey: row.storage_key,
    checksumSha256: row.checksum_sha256,
    createdByProfessionalId: row.created_by_professional_id as never,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  };
}

async function loadDocument(
  client: { query: ClinicalDeps['pool']['query'] },
  personId: string,
  id: string,
): Promise<Document | null> {
  const res = await client.query<DocumentRow>(
    `SELECT document_id, person_id, title, content_type, byte_size, data_class, status,
            scan_status, storage_key, checksum_sha256, created_by_professional_id,
            created_at, updated_at
     FROM documents
     WHERE document_id = $1 AND person_id = $2`,
    [id, personId],
  );
  const row = res.rows[0];
  return row === undefined ? null : mapRow(row);
}

export interface UploadDocumentInput {
  readonly personId: string;
  readonly title: string;
  readonly contentType: string;
  readonly dataClass?: Document['dataClass'];
  readonly bytes: Uint8Array;
  readonly purpose: string;
  readonly requestId?: string;
}

export async function uploadDocument(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  storage: DocumentStorage,
  input: UploadDocumentInput,
): Promise<Document> {
  const professionalId = requireProfessional(actor);
  await authorizeClinical(deps, actor, {
    personId: input.personId,
    category: 'document_read',
    purpose: input.purpose,
    action: 'create',
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  });

  const docId = documentId(crypto.randomUUID());
  const checksum = createHash('sha256').update(input.bytes).digest('hex');
  const storageKey = `persons/${input.personId}/documents/${docId}`;
  const dataClass = input.dataClass ?? 'SHARED_HEALTH';
  const domain = wrapDomain(() =>
    createDocument({
      documentId: docId,
      personId: input.personId as never,
      title: input.title,
      contentType: input.contentType,
      byteSize: input.bytes.byteLength,
      dataClass,
      storageKey,
      checksumSha256: checksum,
      createdByProfessionalId: professionalId as never,
      createdAt: Date.now(),
    }),
  );

  await storage.put(storageKey, input.bytes);

  return runClinicalAsPrincipal(
    deps,
    actor,
    {
      purpose: input.purpose,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    },
    async (client) => {
      const res = await client.query(
        `INSERT INTO documents (
           document_id, person_id, title, content_type, byte_size, data_class, status,
           scan_status, storage_key, checksum_sha256, created_by_professional_id
         ) VALUES ($1, $2, $3, $4, $5, $6, 'initialized', 'pending', $7, $8, $9)`,
        [
          domain.documentId,
          domain.personId,
          domain.title,
          domain.contentType,
          domain.byteSize,
          domain.dataClass,
          domain.storageKey,
          domain.checksumSha256,
          domain.createdByProfessionalId,
        ],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ClinicalError('denied', 'RLS rejected document insert');
      }
      return domain;
    },
  );
}

export interface AdvanceScanInput {
  readonly personId: string;
  readonly documentId: string;
  readonly to: 'pending_scan' | 'available' | 'quarantined' | 'failed';
  readonly purpose: string;
  readonly requestId?: string;
}

/** Server-mediated scan pipeline step (clean/malicious/error). */
export async function advanceDocumentScan(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  input: AdvanceScanInput,
): Promise<Document> {
  requireProfessional(actor);
  await authorizeClinical(deps, actor, {
    personId: input.personId,
    category: 'document_read',
    purpose: input.purpose,
    action: 'update',
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  });
  return runClinicalAsPrincipal(
    deps,
    actor,
    {
      purpose: input.purpose,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    },
    async (client) => {
      const existing = await loadDocument(client, input.personId, input.documentId);
      if (existing === null) {
        throw new ClinicalError('not_found', 'Not found');
      }
      const scanStatus =
        input.to === 'available'
          ? ('clean' as const)
          : input.to === 'quarantined'
            ? ('malicious' as const)
            : input.to === 'failed'
              ? ('error' as const)
              : ('pending' as const);
      const next = wrapDomain(() =>
        transitionDocument(existing, input.to, {
          at: Date.now(),
          scanStatus,
        }),
      );
      const res = await client.query(
        `UPDATE documents SET status = $1, scan_status = $2, updated_at = now()
         WHERE document_id = $3 AND person_id = $4`,
        [next.status, next.scanStatus, input.documentId, input.personId],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ClinicalError('invalid_state', 'Document transition rejected');
      }
      if (next.status === 'available') {
        await queueTimelineProjection(client, {
          personId: input.personId,
          sourceType: 'document',
          sourceId: input.documentId,
        });
      }
      return next;
    },
  );
}

export interface GetDocumentMetadataInput {
  readonly personId: string;
  readonly documentId: string;
  readonly purpose: string;
  readonly requestId?: string;
}

export async function getDocumentMetadata(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  input: GetDocumentMetadataInput,
): Promise<Document> {
  await authorizeClinical(deps, actor, {
    personId: input.personId,
    category: 'document_read',
    purpose: input.purpose,
    action: 'read',
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  });
  const doc = await runClinicalAsPrincipal(
    deps,
    actor,
    {
      purpose: input.purpose,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    },
    (client) => loadDocument(client, input.personId, input.documentId),
  );
  if (doc === null) {
    throw new ClinicalError('not_found', 'Not found');
  }
  return doc;
}

export interface DownloadDocumentInput {
  readonly personId: string;
  readonly documentId: string;
  readonly purpose: string;
  readonly requestId?: string;
}

export interface DocumentDownload {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly checksumSha256: string;
  readonly highSensitivity: boolean;
}

/**
 * Server-mediated content download. HIGH_SENSITIVITY never exposes storage key;
 * bytes stream only after PEP + RLS + available status.
 */
export async function downloadDocument(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  storage: DocumentStorage,
  input: DownloadDocumentInput,
): Promise<DocumentDownload> {
  await authorizeClinical(deps, actor, {
    personId: input.personId,
    category: 'document_read',
    purpose: input.purpose,
    action: 'read',
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  });
  const doc = await runClinicalAsPrincipal(
    deps,
    actor,
    {
      purpose: input.purpose,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    },
    (client) => loadDocument(client, input.personId, input.documentId),
  );
  if (doc === null) {
    throw new ClinicalError('not_found', 'Not found');
  }
  wrapDomain(() => {
    assertDocumentReadable(doc);
  });
  const bytes = await storage.get(doc.storageKey);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== doc.checksumSha256) {
    throw new ClinicalError('conflict', 'Checksum mismatch');
  }
  // High sensitivity: still server-mediated; caller must not log bytes (I-16).
  return {
    bytes,
    contentType: doc.contentType,
    checksumSha256: doc.checksumSha256,
    highSensitivity: isHighSensitivity(doc),
  };
}
