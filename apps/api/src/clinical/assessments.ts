/**
 * Assessments service — Phase 6.
 * draft → signed → amended (domain state machine).
 * Human-only sign (ADR-0012/0013); signed content immutable at DB + domain.
 * Person sees signed/amended only (RLS + service filter); drafts are author workspace.
 */
import {
  amendAssessment,
  assessmentId,
  createAssessment,
  humanProfessional,
  signAssessment,
  updateAssessmentDraft,
  type Assessment,
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

interface AssessmentRow {
  assessment_id: string;
  person_id: string;
  author_professional_id: string;
  status: string;
  title: string;
  body: string;
  version: number;
  predecessor_assessment_id: string | null;
  signed_at: Date | null;
  signed_by_professional_id: string | null;
  amended_at: Date | null;
}

function mapRow(row: AssessmentRow): Assessment {
  return {
    assessmentId: row.assessment_id as never,
    personId: row.person_id as never,
    authorProfessionalId: row.author_professional_id as never,
    status: row.status as Assessment['status'],
    content: { title: row.title, body: row.body },
    version: row.version,
    predecessorAssessmentId: row.predecessor_assessment_id as never,
    signedAt: row.signed_at?.getTime() ?? null,
    signedByProfessionalId: row.signed_by_professional_id as never,
    amendedAt: row.amended_at?.getTime() ?? null,
  };
}

async function loadAssessment(
  client: { query: ClinicalDeps['pool']['query'] },
  personId: string,
  id: string,
): Promise<Assessment | null> {
  const res = await client.query<AssessmentRow>(
    `SELECT assessment_id, person_id, author_professional_id, status, title, body, version,
            predecessor_assessment_id, signed_at, signed_by_professional_id, amended_at
     FROM assessments
     WHERE assessment_id = $1 AND person_id = $2`,
    [id, personId],
  );
  const row = res.rows[0];
  return row === undefined ? null : mapRow(row);
}

export interface CreateAssessmentInput {
  readonly personId: string;
  readonly title: string;
  readonly body: string;
  readonly purpose: string;
  readonly requestId?: string;
}

export async function createAssessmentDraft(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  input: CreateAssessmentInput,
): Promise<Assessment> {
  const professionalId = requireProfessional(actor);
  await authorizeClinical(deps, actor, {
    personId: input.personId,
    category: 'assessment_write',
    purpose: input.purpose,
    action: 'create',
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  });

  const domain = createAssessment({
    assessmentId: assessmentId(crypto.randomUUID()),
    personId: input.personId as never,
    authorProfessionalId: professionalId as never,
    content: { title: input.title, body: input.body },
    createdAt: Date.now(),
  });

  return runClinicalAsPrincipal(
    deps,
    actor,
    {
      purpose: input.purpose,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    },
    async (client) => {
      const res = await client.query<{ assessment_id: string }>(
        `INSERT INTO assessments (assessment_id, person_id, author_professional_id, status, title, body, version)
         VALUES ($1, $2, $3, 'draft', $4, $5, $6)
         RETURNING assessment_id`,
        [
          domain.assessmentId,
          domain.personId,
          domain.authorProfessionalId,
          domain.content.title,
          domain.content.body,
          domain.version,
        ],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ClinicalError('denied', 'RLS rejected assessment insert');
      }
      return domain;
    },
  );
}

export interface UpdateAssessmentInput {
  readonly personId: string;
  readonly assessmentId: string;
  readonly title: string;
  readonly body: string;
  readonly purpose: string;
  readonly requestId?: string;
}

export async function updateAssessment(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  input: UpdateAssessmentInput,
): Promise<Assessment> {
  requireProfessional(actor);
  await authorizeClinical(deps, actor, {
    personId: input.personId,
    category: 'assessment_write',
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
      const existing = await loadAssessment(client, input.personId, input.assessmentId);
      if (existing === null) {
        throw new ClinicalError('not_found', 'Not found');
      }
      const updated = wrapDomain(() =>
        updateAssessmentDraft(existing, {
          title: input.title,
          body: input.body,
        }),
      );
      const res = await client.query(
        `UPDATE assessments SET title = $1, body = $2, updated_at = now()
         WHERE assessment_id = $3 AND person_id = $4 AND status = 'draft'`,
        [updated.content.title, updated.content.body, input.assessmentId, input.personId],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ClinicalError('invalid_state', 'Assessment is not editable');
      }
      return updated;
    },
  );
}

export interface SignAssessmentInput {
  readonly personId: string;
  readonly assessmentId: string;
  readonly purpose: string;
  readonly requestId?: string;
}

export async function signAssessmentRecord(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  input: SignAssessmentInput,
): Promise<Assessment> {
  const professionalId = requireProfessional(actor);
  await authorizeClinical(deps, actor, {
    personId: input.personId,
    category: 'assessment_write',
    purpose: input.purpose,
    action: 'sign',
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
      const existing = await loadAssessment(client, input.personId, input.assessmentId);
      if (existing === null) {
        throw new ClinicalError('not_found', 'Not found');
      }
      const signed = wrapDomain(() =>
        signAssessment({
          assessment: existing,
          signer: humanProfessional(actor.emailNormalized),
          signerProfessionalId: professionalId as never,
          signedAt: Date.now(),
        }),
      );
      const res = await client.query(
        `UPDATE assessments
         SET status = 'signed', signed_at = to_timestamp($1 / 1000.0),
             signed_by_professional_id = $2, updated_at = now()
         WHERE assessment_id = $3 AND person_id = $4 AND status = 'draft'`,
        [signed.signedAt, professionalId, input.assessmentId, input.personId],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ClinicalError('invalid_state', 'Assessment is not signable');
      }
      await queueTimelineProjection(client, {
        personId: input.personId,
        sourceType: 'assessment',
        sourceId: input.assessmentId,
      });
      return signed;
    },
  );
}

export interface AmendAssessmentInput {
  readonly personId: string;
  readonly assessmentId: string;
  readonly title: string;
  readonly body: string;
  readonly purpose: string;
  readonly requestId?: string;
}

export async function amendAssessmentRecord(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  input: AmendAssessmentInput,
): Promise<{ predecessor: Assessment; successor: Assessment }> {
  const professionalId = requireProfessional(actor);
  await authorizeClinical(deps, actor, {
    personId: input.personId,
    category: 'assessment_write',
    purpose: input.purpose,
    action: 'amend',
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
      const existing = await loadAssessment(client, input.personId, input.assessmentId);
      if (existing === null) {
        throw new ClinicalError('not_found', 'Not found');
      }
      const successorId = assessmentId(crypto.randomUUID());
      const amendedAt = Date.now();
      const { predecessor, successor } = wrapDomain(() =>
        amendAssessment({
          signedAssessment: existing,
          successorAssessmentId: successorId,
          revisedContent: { title: input.title, body: input.body },
          amendedByProfessionalId: professionalId as never,
          amendedAt,
        }),
      );
      const updated = await client.query(
        `UPDATE assessments SET status = 'amended', amended_at = to_timestamp($1 / 1000.0),
                                updated_at = now()
         WHERE assessment_id = $2 AND person_id = $3 AND status = 'signed'`,
        [amendedAt, input.assessmentId, input.personId],
      );
      if ((updated.rowCount ?? 0) === 0) {
        throw new ClinicalError('denied', 'RLS rejected assessment amendment');
      }
      const insert = await client.query<{ assessment_id: string }>(
        `INSERT INTO assessments (
           assessment_id, person_id, author_professional_id, status, title, body, version,
           predecessor_assessment_id
         ) VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7)
         RETURNING assessment_id`,
        [
          successor.assessmentId,
          successor.personId,
          successor.authorProfessionalId,
          successor.content.title,
          successor.content.body,
          successor.version,
          predecessor.assessmentId,
        ],
      );
      if ((insert.rowCount ?? 0) === 0) {
        throw new ClinicalError('denied', 'RLS rejected amendment successor');
      }
      await queueTimelineProjection(client, {
        personId: input.personId,
        sourceType: 'assessment',
        sourceId: input.assessmentId,
      });
      return { predecessor, successor };
    },
  );
}

export interface ListAssessmentsInput {
  readonly personId: string;
  readonly purpose: string;
  /** When principal is person, drafts are excluded by RLS; service never widens that. */
  readonly includeDrafts?: boolean;
  readonly limit?: number;
  readonly requestId?: string;
}

export async function listAssessments(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  input: ListAssessmentsInput,
): Promise<readonly Assessment[]> {
  await authorizeClinical(deps, actor, {
    personId: input.personId,
    category: 'assessment_read',
    purpose: input.purpose,
    action: 'read',
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  });
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const professional = actor.professionalId !== null;
  const showDrafts = professional && input.includeDrafts !== false;
  const { rows } = await runClinicalAsPrincipal(
    deps,
    actor,
    {
      purpose: input.purpose,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    },
    (client) =>
      client.query<AssessmentRow>(
        `SELECT assessment_id, person_id, author_professional_id, status, title, body, version,
                predecessor_assessment_id, signed_at, signed_by_professional_id, amended_at
         FROM assessments
         WHERE person_id = $1
           AND ($2::boolean OR status <> 'draft')
         ORDER BY updated_at DESC
         LIMIT $3`,
        [input.personId, showDrafts, limit],
      ),
  );
  return rows.map(mapRow);
}
