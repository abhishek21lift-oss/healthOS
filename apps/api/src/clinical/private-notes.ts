/**
 * Private professional notes — Phase 6 (ADR-0005, I-4/I-5).
 * Author-only create/read/update/void/promote.
 * NEVER uses ordinary AccessGrant path — PEP returns PRIVATE_NOTE for category.
 * RLS author-only is the second gate; promotion writes a shared assessment copy.
 */
import {
  createPrivateNote as domainCreateNote,
  privateProfessionalNoteId,
  promotePrivateNote,
  updatePrivateNote,
  voidPrivateNote,
  type PromotedNoteCopy,
  type PrivateProfessionalNote,
} from '@health-os/domain';

import { authorizeClinical, runClinicalAsPrincipal } from './pep.js';
import {
  ClinicalError,
  requireProfessional,
  requirePurpose,
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

interface PrivateNoteRow {
  note_id: string;
  person_id: string;
  author_professional_id: string;
  status: string;
  data_class: string;
  body: string;
  created_at: Date;
  updated_at: Date;
  voided_at: Date | null;
}

function mapRow(row: PrivateNoteRow): PrivateProfessionalNote {
  return {
    noteId: row.note_id as never,
    personId: row.person_id as never,
    authorProfessionalId: row.author_professional_id as never,
    status: row.status as PrivateProfessionalNote['status'],
    dataClass: 'PROFESSIONAL_PRIVATE',
    body: row.body,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
    voidedAt: row.voided_at?.getTime() ?? null,
  };
}

async function assertAuthorOnly(
  client: { query: ClinicalDeps['pool']['query'] },
  actor: ClinicalActor,
  noteId: string,
  personId: string,
): Promise<PrivateProfessionalNote> {
  const professionalId = requireProfessional(actor);
  const res = await client.query<PrivateNoteRow>(
    `SELECT note_id, person_id, author_professional_id, status, data_class, body,
            created_at, updated_at, voided_at
     FROM private_professional_notes
     WHERE note_id = $1 AND person_id = $2`,
    [noteId, personId],
  );
  const row = res.rows[0];
  if (row === undefined) {
    // Existence leak prevention: non-author RLS already hides rows.
    throw new ClinicalError('not_found', 'Not found');
  }
  if (row.author_professional_id !== professionalId) {
    throw new ClinicalError('not_found', 'Not found');
  }
  return mapRow(row);
}

export interface CreatePrivateNoteInput {
  readonly personId: string;
  readonly body: string;
  /** Required on every private-note request (I-19) even though grant chain is unused. */
  readonly purpose: string;
  readonly requestId?: string;
}

export async function createPrivateNote(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  input: CreatePrivateNoteInput,
): Promise<PrivateProfessionalNote> {
  const professionalId = requireProfessional(actor);
  requirePurpose(input.purpose);
  // Fail closed: private_note_read never allows via ordinary PEP.
  await authorizeClinical(deps, actor, {
    personId: input.personId,
    category: 'private_note_read',
    purpose: input.purpose,
    action: 'create',
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  }).then(
    () => {
      throw new ClinicalError('denied', 'Private notes never use AccessGrant path', {
        denyReason: 'PRIVATE_NOTE',
      });
    },
    (error: unknown) => {
      // Expected deny from PEP (PRIVATE_NOTE). Any other error is unexpected.
      if (error instanceof ClinicalError && error.denyReason === 'PRIVATE_NOTE') {
        return;
      }
      if (error instanceof ClinicalError) {
        throw error;
      }
      throw error;
    },
  );

  const now = Date.now();
  const domain = wrapDomain(() =>
    domainCreateNote({
      noteId: privateProfessionalNoteId(crypto.randomUUID()),
      personId: input.personId as never,
      authorProfessionalId: professionalId as never,
      body: input.body,
      createdAt: now,
    }),
  );

  return runClinicalAsPrincipal(
    deps,
    actor,
    {
      purpose: input.purpose,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    },
    async (client) => {
      const res = await client.query<{ note_id: string }>(
        `INSERT INTO private_professional_notes (
           note_id, person_id, author_professional_id, status, data_class, body
         ) VALUES ($1, $2, $3, 'active', 'PROFESSIONAL_PRIVATE', $4)
         RETURNING note_id`,
        [domain.noteId, domain.personId, domain.authorProfessionalId, domain.body],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ClinicalError('denied', 'RLS rejected private note insert');
      }
      return domain;
    },
  );
}

export interface ReadPrivateNoteInput {
  readonly personId: string;
  readonly noteId: string;
  readonly purpose: string;
  readonly requestId?: string;
}

export async function readPrivateNote(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  input: ReadPrivateNoteInput,
): Promise<PrivateProfessionalNote> {
  requireProfessional(actor);
  requirePurpose(input.purpose);
  return runClinicalAsPrincipal(
    deps,
    actor,
    {
      purpose: input.purpose,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    },
    (client) => assertAuthorOnly(client, actor, input.noteId, input.personId),
  );
}

export interface ListPrivateNotesInput {
  readonly personId: string;
  readonly purpose: string;
  readonly requestId?: string;
}

export async function listPrivateNotes(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  input: ListPrivateNotesInput,
): Promise<readonly PrivateProfessionalNote[]> {
  requireProfessional(actor);
  requirePurpose(input.purpose);
  const { rows } = await runClinicalAsPrincipal(
    deps,
    actor,
    {
      purpose: input.purpose,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    },
    (client) =>
      client.query<PrivateNoteRow>(
        `SELECT note_id, person_id, author_professional_id, status, data_class, body,
                created_at, updated_at, voided_at
         FROM private_professional_notes
         WHERE person_id = $1
         ORDER BY updated_at DESC
         LIMIT 100`,
        [input.personId],
      ),
  );
  // RLS returns author-only rows; assertAuthorOnly is not needed per-row.
  return rows.map(mapRow);
}

export interface UpdatePrivateNoteInput {
  readonly personId: string;
  readonly noteId: string;
  readonly body: string;
  readonly purpose: string;
  readonly requestId?: string;
}

export async function updatePrivateNoteRecord(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  input: UpdatePrivateNoteInput,
): Promise<PrivateProfessionalNote> {
  const professionalId = requireProfessional(actor);
  requirePurpose(input.purpose);
  return runClinicalAsPrincipal(
    deps,
    actor,
    {
      purpose: input.purpose,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    },
    async (client) => {
      const existing = await assertAuthorOnly(client, actor, input.noteId, input.personId);
      const updated = wrapDomain(() =>
        updatePrivateNote(existing, {
          body: input.body,
          actorProfessionalId: professionalId as never,
          at: Date.now(),
        }),
      );
      const res = await client.query(
        `UPDATE private_professional_notes
         SET body = $1, updated_at = to_timestamp($2 / 1000.0)
         WHERE note_id = $3 AND person_id = $4 AND status = 'active'
           AND author_professional_id = $5`,
        [updated.body, updated.updatedAt, input.noteId, input.personId, professionalId],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ClinicalError('invalid_state', 'Private note is not editable');
      }
      return updated;
    },
  );
}

export interface VoidPrivateNoteInput {
  readonly personId: string;
  readonly noteId: string;
  readonly purpose: string;
  readonly requestId?: string;
}

export async function voidPrivateNoteRecord(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  input: VoidPrivateNoteInput,
): Promise<PrivateProfessionalNote> {
  const professionalId = requireProfessional(actor);
  requirePurpose(input.purpose);
  return runClinicalAsPrincipal(
    deps,
    actor,
    {
      purpose: input.purpose,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    },
    async (client) => {
      const existing = await assertAuthorOnly(client, actor, input.noteId, input.personId);
      const voided = wrapDomain(() =>
        voidPrivateNote(existing, {
          actorProfessionalId: professionalId as never,
          at: Date.now(),
        }),
      );
      const res = await client.query(
        `UPDATE private_professional_notes
         SET status = 'voided', voided_at = to_timestamp($1 / 1000.0),
             updated_at = to_timestamp($1 / 1000.0)
         WHERE note_id = $2 AND person_id = $3 AND status = 'active'
           AND author_professional_id = $4`,
        [voided.voidedAt, input.noteId, input.personId, professionalId],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ClinicalError('invalid_state', 'Private note is not voidable');
      }
      return voided;
    },
  );
}

export interface PromotePrivateNoteInput {
  readonly personId: string;
  readonly noteId: string;
  readonly purpose: string;
  readonly requestId?: string;
}

/**
 * Promotion: shared assessment copy with provenance; original stays private forever (I-5).
 * Shared copy requires ordinary assessment_write PEP + RLS.
 */
export async function promotePrivateNoteRecord(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  input: PromotePrivateNoteInput,
): Promise<{ promoted: PromotedNoteCopy; assessmentId: string }> {
  const professionalId = requireProfessional(actor);
  requirePurpose(input.purpose);

  const promoted = await runClinicalAsPrincipal(
    deps,
    actor,
    {
      purpose: input.purpose,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    },
    async (client) => {
      const existing = await assertAuthorOnly(client, actor, input.noteId, input.personId);
      return wrapDomain(() =>
        promotePrivateNote(existing, {
          actorProfessionalId: professionalId as never,
          at: Date.now(),
        }),
      );
    },
  );

  // Shared copy goes through ordinary assessment_write authorization (not private path).
  await authorizeClinical(deps, actor, {
    personId: input.personId,
    category: 'assessment_write',
    purpose: input.purpose,
    action: 'create',
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  });

  const newAssessmentId = crypto.randomUUID();
  await runClinicalAsPrincipal(
    deps,
    actor,
    {
      purpose: input.purpose,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    },
    async (client) => {
      const res = await client.query(
        `INSERT INTO assessments (
           assessment_id, person_id, author_professional_id, status, title, body, version
         ) VALUES ($1, $2, $3, 'draft', $4, $5, 1)`,
        [newAssessmentId, input.personId, professionalId, 'Promoted private note', promoted.body],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ClinicalError('denied', 'RLS rejected promoted assessment');
      }
      await client.query(
        `INSERT INTO audit_logs (
           actor_principal_type, actor_principal_id, action, resource_type, resource_id,
           person_id, purpose, access_decision, severity, metadata
         ) VALUES ('professional', $1, 'private_note_promoted', 'private_note', $2::uuid,
                   $3::uuid, $4, 'allow', 'info', $5::jsonb)`,
        [
          professionalId,
          input.noteId,
          input.personId,
          input.purpose,
          JSON.stringify({
            provenance: promoted.provenance,
            assessmentId: newAssessmentId,
            // No note body in audit metadata (I-16).
          }),
        ],
      );
    },
  );

  return { promoted, assessmentId: newAssessmentId };
}
