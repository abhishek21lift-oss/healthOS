/**
 * Phase 6 clinical RLS direct-SQL matrix (defense-in-depth).
 * Independent of service layer — proves PostgreSQL alone enforces I-1/I-3/I-4.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createPool,
  defaultTestDsn,
  runInPrincipalContext,
  runMigrations,
  withClient,
  type Pool,
} from '@health-os/database';

const superDsn = defaultTestDsn('postgres');
const appDsn = defaultTestDsn('app');

let superPool: Pool;
let appPool: Pool;

interface Fixture {
  personId: string;
  otherPersonId: string;
  doctorId: string;
  nurseId: string;
  adminId: string;
  assessmentId: string;
  signedAssessmentId: string;
  draftAssessmentId: string;
  observationId: string;
  documentId: string;
  doctorNoteId: string;
  nurseNoteId: string;
}

async function seed(): Promise<Fixture> {
  return withClient(superPool, async (c) => {
    await c.query(`TRUNCATE TABLE
      audit_logs, person_access_logs, access_grants, access_requests,
      consent_revisions, consents, person_professional_relationships,
      documents, private_professional_notes, outcomes, interventions, goals,
      care_plans, assessments, observations, care_team_memberships, care_teams,
      organization_memberships, organizations CASCADE`);

    const p1 = await c.query<{ person_id: string }>(
      `INSERT INTO persons (display_name, is_adult) VALUES ('RLS Alice', true) RETURNING person_id`,
    );
    const p2 = await c.query<{ person_id: string }>(
      `INSERT INTO persons (display_name, is_adult) VALUES ('RLS Bob', true) RETURNING person_id`,
    );
    const doctor = await c.query<{ professional_id: string }>(
      `INSERT INTO professionals (display_name) VALUES ('RLS Dr') RETURNING professional_id`,
    );
    const nurse = await c.query<{ professional_id: string }>(
      `INSERT INTO professionals (display_name) VALUES ('RLS RN') RETURNING professional_id`,
    );
    const admin = await c.query<{ professional_id: string }>(
      `INSERT INTO professionals (display_name) VALUES ('RLS Admin') RETURNING professional_id`,
    );
    const personId = p1.rows[0]?.person_id ?? '';
    const otherPersonId = p2.rows[0]?.person_id ?? '';
    const doctorId = doctor.rows[0]?.professional_id ?? '';
    const nurseId = nurse.rows[0]?.professional_id ?? '';
    const adminId = admin.rows[0]?.professional_id ?? '';

    const org = await c.query<{ organization_id: string }>(
      `INSERT INTO organizations (name) VALUES ('RLS Org') RETURNING organization_id`,
    );
    await c.query(
      `INSERT INTO organization_memberships (organization_id, professional_id, status, role)
       VALUES ($1, $2, 'active', 'admin')`,
      [org.rows[0]?.organization_id ?? '', adminId],
    );

    const team = await c.query<{ care_team_id: string }>(
      `INSERT INTO care_teams (person_id, status) VALUES ($1, 'open') RETURNING care_team_id`,
      [personId],
    );
    const careTeamId = team.rows[0]?.care_team_id ?? '';
    for (const prof of [doctorId, nurseId]) {
      await c.query(
        `INSERT INTO care_team_memberships (care_team_id, person_id, professional_id, status)
         VALUES ($1, $2, $3, 'active')`,
        [careTeamId, personId, prof],
      );
      await c.query(
        `INSERT INTO person_professional_relationships
           (person_id, professional_id, care_team_id, collaboration_context, status)
         VALUES ($1, $2, $3, 'care_coordination', 'active')`,
        [personId, prof, careTeamId],
      );
    }

    // Doctor full grants via consent+grants (as superuser seed).
    const consent = await c.query<{ consent_id: string }>(
      `INSERT INTO consents (person_id, grantee_professional_id, status)
       VALUES ($1, $2, 'active') RETURNING consent_id`,
      [personId, doctorId],
    );
    const rev = await c.query<{ consent_revision_id: string }>(
      `INSERT INTO consent_revisions (
         consent_id, revision_number, person_id, grantee_professional_id,
         categories, purposes, status, effective_from, issued_by_person_id
       ) VALUES ($1, 1, $2, $3,
         ARRAY['timeline_read','assessment_read','assessment_write','goal_read','goal_write',
               'care_plan_read','care_plan_write','intervention_read','outcome_read','document_read']::text[],
         ARRAY['treatment','person_requested']::text[], 'active', now(), $2)
       RETURNING consent_revision_id`,
      [consent.rows[0]?.consent_id ?? '', personId, doctorId],
    );
    const mem = await c.query<{ membership_id: string }>(
      `SELECT membership_id FROM care_team_memberships
       WHERE person_id = $1 AND professional_id = $2`,
      [personId, doctorId],
    );
    const categories = [
      'timeline_read',
      'assessment_read',
      'assessment_write',
      'goal_read',
      'goal_write',
      'care_plan_read',
      'care_plan_write',
      'intervention_read',
      'outcome_read',
      'document_read',
    ];
    for (const category of categories) {
      await c.query(
        `INSERT INTO access_grants (
           person_id, grantee_professional_id, category, purpose, status,
           relationship_class, membership_id, consent_revision_id
         ) VALUES ($1, $2, $3, 'treatment', 'active', 'care_team_member', $4, $5)`,
        [
          personId,
          doctorId,
          category,
          mem.rows[0]?.membership_id ?? '',
          rev.rows[0]?.consent_revision_id ?? '',
        ],
      );
    }

    const draft = await c.query<{ assessment_id: string }>(
      `INSERT INTO assessments (person_id, author_professional_id, status, title, body)
       VALUES ($1, $2, 'draft', 'RLS draft', 'd') RETURNING assessment_id`,
      [personId, doctorId],
    );
    const signed = await c.query<{ assessment_id: string }>(
      `INSERT INTO assessments (person_id, author_professional_id, status, title, body,
                                signed_at, signed_by_professional_id)
       VALUES ($1, $2, 'signed', 'RLS signed', 's', now(), $2) RETURNING assessment_id`,
      [personId, doctorId],
    );
    const obs = await c.query<{ observation_id: string }>(
      `INSERT INTO observations (person_id, code, value_numeric, unit)
       VALUES ($1, 'hr', 70, 'bpm') RETURNING observation_id`,
      [personId],
    );
    const doc = await c.query<{ document_id: string; storage_key: string }>(
      `INSERT INTO documents (person_id, title, content_type, byte_size, storage_key,
                              checksum_sha256, created_by_professional_id, status, scan_status)
       VALUES ($1, 'RLS doc', 'application/pdf', 10, 'k/1', repeat('a', 64), $2, 'available', 'clean')
       RETURNING document_id, storage_key`,
      [personId, doctorId],
    );
    const dNote = await c.query<{ note_id: string }>(
      `INSERT INTO private_professional_notes (person_id, author_professional_id, body)
       VALUES ($1, $2, 'doc private') RETURNING note_id`,
      [personId, doctorId],
    );
    const nNote = await c.query<{ note_id: string }>(
      `INSERT INTO private_professional_notes (person_id, author_professional_id, body)
       VALUES ($1, $2, 'nurse private') RETURNING note_id`,
      [personId, nurseId],
    );

    return {
      personId,
      otherPersonId,
      doctorId,
      nurseId,
      adminId,
      assessmentId: draft.rows[0]?.assessment_id ?? '',
      signedAssessmentId: signed.rows[0]?.assessment_id ?? '',
      draftAssessmentId: draft.rows[0]?.assessment_id ?? '',
      observationId: obs.rows[0]?.observation_id ?? '',
      documentId: doc.rows[0]?.document_id ?? '',
      doctorNoteId: dNote.rows[0]?.note_id ?? '',
      nurseNoteId: nNote.rows[0]?.note_id ?? '',
    };
  });
}

let fx: Fixture;

async function countAs(
  principalType: 'person' | 'professional' | 'system',
  principalId: string,
  purpose: string,
  sql: string,
  params: readonly unknown[] = [],
): Promise<number> {
  return runInPrincipalContext(appPool, { principalType, principalId, purpose }, async (client) => {
    const r = await client.query(sql, [...params]);
    return r.rowCount ?? 0;
  });
}

beforeAll(async () => {
  superPool = createPool({ connectionString: superDsn, max: 4 });
  appPool = createPool({ connectionString: appDsn, max: 4 });
  await runMigrations(superPool);
}, 180_000);

beforeEach(async () => {
  fx = await seed();
});

afterAll(async () => {
  await superPool.end();
  await appPool.end();
});

describe('Phase 6 RLS matrix', () => {
  it('doctor with grants sees signed + draft assessments', async () => {
    const n = await countAs(
      'professional',
      fx.doctorId,
      'treatment',
      `SELECT 1 FROM assessments WHERE person_id = $1`,
      [fx.personId],
    );
    expect(n).toBe(2);
  });

  it('person sees only non-draft assessments (I: person excludes drafts)', async () => {
    const rows = await runInPrincipalContext(
      appPool,
      { principalType: 'person', principalId: fx.personId, purpose: 'person_requested' },
      async (client) => {
        const r = await client.query<{ status: string }>(
          `SELECT status FROM assessments WHERE person_id = $1`,
          [fx.personId],
        );
        return r.rows;
      },
    );
    expect(rows.every((r) => r.status !== 'draft')).toBe(true);
    expect(rows).toHaveLength(1);
  });

  it('nurse membership without grant sees zero clinical rows', async () => {
    for (const sql of [
      `SELECT 1 FROM assessments WHERE person_id = '${fx.personId}'`,
      `SELECT 1 FROM observations WHERE person_id = '${fx.personId}'`,
      `SELECT 1 FROM documents WHERE person_id = '${fx.personId}'`,
      `SELECT 1 FROM goals WHERE person_id = '${fx.personId}'`,
    ]) {
      const n = await countAs('professional', fx.nurseId, 'treatment', sql);
      expect(n).toBe(0);
    }
  });

  it('org admin sees zero clinical rows (I-3)', async () => {
    const n = await countAs(
      'professional',
      fx.adminId,
      'treatment',
      `SELECT 1 FROM assessments WHERE person_id = $1`,
      [fx.personId],
    );
    expect(n).toBe(0);
    const docs = await countAs(
      'professional',
      fx.adminId,
      'treatment',
      `SELECT 1 FROM documents WHERE person_id = $1`,
      [fx.personId],
    );
    expect(docs).toBe(0);
  });

  it('cross-person: professional with grants on Alice cannot read Bob', async () => {
    const n = await countAs(
      'professional',
      fx.doctorId,
      'treatment',
      `SELECT 1 FROM assessments WHERE person_id = $1`,
      [fx.otherPersonId],
    );
    expect(n).toBe(0);
  });

  it('private notes: doctor sees only own author rows', async () => {
    const rows = await runInPrincipalContext(
      appPool,
      { principalType: 'professional', principalId: fx.doctorId, purpose: 'treatment' },
      async (client) =>
        client.query<{ note_id: string }>(`SELECT note_id FROM private_professional_notes`),
    );
    expect(rows.rows.map((r) => r.note_id)).toEqual([fx.doctorNoteId]);
  });

  it('private notes: nurse sees only own; never doctor note (I-4)', async () => {
    const rows = await runInPrincipalContext(
      appPool,
      { principalType: 'professional', principalId: fx.nurseId, purpose: 'treatment' },
      async (client) =>
        client.query<{ note_id: string }>(`SELECT note_id FROM private_professional_notes`),
    );
    expect(rows.rows.map((r) => r.note_id)).toEqual([fx.nurseNoteId]);
    expect(rows.rows.map((r) => r.note_id)).not.toContain(fx.doctorNoteId);
  });

  it('private notes: person sees zero rows (I-4)', async () => {
    const n = await countAs(
      'person',
      fx.personId,
      'person_requested',
      `SELECT 1 FROM private_professional_notes`,
    );
    expect(n).toBe(0);
  });

  it('private notes: org admin sees zero rows (I-4)', async () => {
    const n = await countAs(
      'professional',
      fx.adminId,
      'treatment',
      `SELECT 1 FROM private_professional_notes WHERE person_id = $1`,
      [fx.personId],
    );
    expect(n).toBe(0);
  });

  it('private notes: no context principal sees zero', async () => {
    await expect(
      withClient(appPool, (c) => c.query(`SELECT 1 FROM private_professional_notes`)),
    ).resolves.toMatchObject({ rowCount: 0 });
  });

  it('nurse cannot INSERT observation without grant (RLS)', async () => {
    await expect(
      runInPrincipalContext(
        appPool,
        { principalType: 'professional', principalId: fx.nurseId, purpose: 'treatment' },
        (client) =>
          client.query(
            `INSERT INTO observations (person_id, code, value_numeric) VALUES ($1, 'x', 1)`,
            [fx.personId],
          ),
      ),
    ).rejects.toThrow();
  });

  it('doctor with grants can INSERT observation', async () => {
    const n = await runInPrincipalContext(
      appPool,
      { principalType: 'professional', principalId: fx.doctorId, purpose: 'treatment' },
      async (client) => {
        const r = await client.query(
          `INSERT INTO observations (person_id, code, value_numeric) VALUES ($1, 'bp', 120)`,
          [fx.personId],
        );
        return r.rowCount ?? 0;
      },
    );
    expect(n).toBe(1);
  });

  it('doctor cannot UPDATE signed assessment content (trigger) + superuser hits immutability trigger', async () => {
    // RLS allows author signed-row UPDATE for amend (status only); content edit hits trigger.
    await expect(
      runInPrincipalContext(
        appPool,
        { principalType: 'professional', principalId: fx.doctorId, purpose: 'treatment' },
        (client) =>
          client.query(`UPDATE assessments SET body = 'x' WHERE assessment_id = $1`, [
            fx.signedAssessmentId,
          ]),
      ),
    ).rejects.toThrow(/immutable/i);

    // Superuser bypasses RLS (disaster-recovery path) → immutability trigger must fire.
    await expect(
      withClient(superPool, (c) =>
        c.query(`UPDATE assessments SET body = 'tampered' WHERE assessment_id = $1`, [
          fx.signedAssessmentId,
        ]),
      ),
    ).rejects.toThrow(/immutable/i);
  });

  it('health_app cannot DELETE documents (privilege)', async () => {
    await expect(
      runInPrincipalContext(
        appPool,
        { principalType: 'professional', principalId: fx.doctorId, purpose: 'treatment' },
        (client) => client.query(`DELETE FROM documents WHERE document_id = $1`, [fx.documentId]),
      ),
    ).rejects.toThrow();
  });

  it('documents: doctor with grant sees document; nurse does not', async () => {
    const doctorN = await countAs(
      'professional',
      fx.doctorId,
      'treatment',
      `SELECT 1 FROM documents WHERE person_id = $1`,
      [fx.personId],
    );
    expect(doctorN).toBe(1);
    const nurseN = await countAs(
      'professional',
      fx.nurseId,
      'treatment',
      `SELECT 1 FROM documents WHERE person_id = $1`,
      [fx.personId],
    );
    expect(nurseN).toBe(0);
  });

  it('no purpose context denies health reads (begin_request required)', async () => {
    await expect(
      withClient(appPool, (c) =>
        c.query(`SELECT 1 FROM assessments WHERE person_id = $1`, [fx.personId]),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
  });
});
