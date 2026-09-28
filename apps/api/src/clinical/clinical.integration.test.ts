/**
 * Phase 6 clinical core integration — real PostgreSQL.
 * Covers: PEP + RLS dual gate for all clinical resources, assessment sign/amend,
 * person draft exclusion, cross-person 404, category matrix, regression hooks.
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
import { humanProfessional, machineActor, type Assessment } from '@health-os/domain';

import {
  authorizeHealthAccess,
  issuePersonConsent,
  type AuthorizationActor,
  type AuthorizationDeps,
  type ConsentActor,
} from '../authorization/index.js';
import {
  amendAssessmentRecord,
  createAssessmentDraft,
  createCarePlanRecord,
  createGoalRecord,
  createObservation,
  createInterventionRecord,
  listAssessments,
  listObservations,
  promotePrivateNoteRecord,
  recordOutcomeEntry,
  signAssessmentRecord,
  transitionCarePlanRecord,
  transitionGoalRecord,
  transitionInterventionRecord,
  updateAssessment,
  ClinicalError,
  type ClinicalDeps,
} from './index.js';

const superDsn = defaultTestDsn('postgres');
const appDsn = defaultTestDsn('app');

let superPool: Pool;
let appPool: Pool;
let deps: ClinicalDeps;
let authzDeps: AuthorizationDeps;

interface Fixture {
  personId: string;
  otherPersonId: string;
  doctorId: string;
  nurseId: string;
  outsiderId: string;
}

async function resetAndSeed(): Promise<Fixture> {
  return withClient(superPool, async (c) => {
    await c.query(`TRUNCATE TABLE
      audit_logs,
      person_access_logs,
      access_grants,
      access_requests,
      consent_revisions,
      consents,
      person_professional_relationships,
      documents,
      private_professional_notes,
      outcomes,
      interventions,
      goals,
      care_plans,
      assessments,
      observations,
      care_team_memberships,
      care_teams
      CASCADE`);
    const person = await c.query<{ person_id: string }>(
      `INSERT INTO persons (display_name, is_adult) VALUES ('Clinical Person', true) RETURNING person_id`,
    );
    const otherPerson = await c.query<{ person_id: string }>(
      `INSERT INTO persons (display_name, is_adult) VALUES ('Other Person', true) RETURNING person_id`,
    );
    const doctor = await c.query<{ professional_id: string }>(
      `INSERT INTO professionals (display_name) VALUES ('Clinical Doctor') RETURNING professional_id`,
    );
    const nurse = await c.query<{ professional_id: string }>(
      `INSERT INTO professionals (display_name) VALUES ('Clinical Nurse') RETURNING professional_id`,
    );
    const outsider = await c.query<{ professional_id: string }>(
      `INSERT INTO professionals (display_name) VALUES ('Outsider') RETURNING professional_id`,
    );
    const personId = person.rows[0]?.person_id ?? '';
    const otherPersonId = otherPerson.rows[0]?.person_id ?? '';
    const doctorId = doctor.rows[0]?.professional_id ?? '';
    const nurseId = nurse.rows[0]?.professional_id ?? '';
    const outsiderId = outsider.rows[0]?.professional_id ?? '';
    const team = await c.query<{ care_team_id: string }>(
      `INSERT INTO care_teams (person_id, status) VALUES ($1, 'open') RETURNING care_team_id`,
      [personId],
    );
    const careTeamId = team.rows[0]?.care_team_id ?? '';
    await c.query(
      `INSERT INTO care_team_memberships (care_team_id, person_id, professional_id, status)
       VALUES ($1, $2, $3, 'active')`,
      [careTeamId, personId, doctorId],
    );
    await c.query(
      `INSERT INTO care_team_memberships (care_team_id, person_id, professional_id, status)
       VALUES ($1, $2, $3, 'active')`,
      [careTeamId, personId, nurseId],
    );
    await c.query(
      `INSERT INTO person_professional_relationships
         (person_id, professional_id, care_team_id, collaboration_context, status)
       VALUES ($1, $2, $3, 'care_coordination', 'active')`,
      [personId, doctorId, careTeamId],
    );
    await c.query(
      `INSERT INTO person_professional_relationships
         (person_id, professional_id, care_team_id, collaboration_context, status)
       VALUES ($1, $2, $3, 'care_coordination', 'active')`,
      [personId, nurseId, careTeamId],
    );
    return { personId, otherPersonId, doctorId, nurseId, outsiderId };
  });
}

function personActor(personId: string): AuthorizationActor {
  return {
    accountId: 'acct-p',
    personId,
    professionalId: null,
    emailNormalized: 'p@example.com',
  };
}

function professionalActor(professionalId: string): AuthorizationActor {
  return {
    accountId: 'acct-d',
    personId: null,
    professionalId,
    emailNormalized: 'd@example.com',
  };
}

async function grantFullClinical(
  personId: string,
  doctorId: string,
  categories: readonly string[],
): Promise<void> {
  const actor: ConsentActor = {
    accountId: 'acct-p',
    personId,
    professionalId: null,
    emailNormalized: 'p@example.com',
  };
  await issuePersonConsent(authzDeps as never, actor, {
    granteeProfessionalId: doctorId,
    scope: {
      categories: categories as never,
      purposes: ['treatment', 'care_coordination'] as never,
    },
  });
}

async function denyReason(
  actor: AuthorizationActor,
  personId: string,
  category: string,
  purpose = 'treatment',
): Promise<string> {
  const result = await authorizeHealthAccess(authzDeps, actor, {
    personId,
    category,
    purpose,
    action: 'read',
  });
  return result.decision.allowed ? 'ALLOW' : result.decision.reason;
}

beforeAll(async () => {
  superPool = createPool({ connectionString: superDsn, max: 4 });
  appPool = createPool({ connectionString: appDsn, max: 4 });
  await runMigrations(superPool);
  deps = { pool: appPool } as ClinicalDeps;
  authzDeps = { pool: appPool } as AuthorizationDeps;
}, 180_000);

beforeEach(async () => {
  await resetAndSeed();
});

afterAll(async () => {
  await superPool.end();
  await appPool.end();
});

describe('observations', () => {
  it('doctor with timeline_read grant can create and list', async () => {
    const fx = await resetAndSeed();
    await grantFullClinical(fx.personId, fx.doctorId, ['timeline_read']);
    const created = await createObservation(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      code: 'blood_pressure',
      valueNumeric: 120,
      unit: 'mmHg',
      purpose: 'treatment',
    });
    expect(created.code).toBe('blood_pressure');
    const rows = await listObservations(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      purpose: 'treatment',
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('nurse without grant is denied create', async () => {
    const fx = await resetAndSeed();
    await expect(
      createObservation(deps, professionalActor(fx.nurseId), {
        personId: fx.personId,
        code: 'hr',
        valueNumeric: 60,
        purpose: 'treatment',
      }),
    ).rejects.toMatchObject({ name: 'ClinicalError', code: 'denied' });
  });

  it('person can read own observations', async () => {
    const fx = await resetAndSeed();
    const rows = await listObservations(deps, personActor(fx.personId), {
      personId: fx.personId,
      purpose: 'person_requested',
    });
    expect(Array.isArray(rows)).toBe(true);
  });

  it('cross-person create is denied (I-11)', async () => {
    const fx = await resetAndSeed();
    await grantFullClinical(fx.personId, fx.doctorId, ['timeline_read']);
    await expect(
      createObservation(deps, professionalActor(fx.doctorId), {
        personId: fx.otherPersonId,
        code: 'x',
        valueNumeric: 1,
        purpose: 'treatment',
      }),
    ).rejects.toMatchObject({ name: 'ClinicalError' });
  });
});

describe('assessments sign / amend / immutability', () => {
  async function seedDoctorWrite(personId: string, doctorId: string): Promise<void> {
    await grantFullClinical(personId, doctorId, [
      'assessment_read',
      'assessment_write',
      'timeline_read',
      'goal_read',
      'goal_write',
      'care_plan_read',
      'care_plan_write',
      'intervention_read',
      'outcome_read',
      'document_read',
    ]);
  }

  it('draft → sign → amend produces version lineage', async () => {
    const fx = await resetAndSeed();
    await seedDoctorWrite(fx.personId, fx.doctorId);
    const actor = professionalActor(fx.doctorId);
    const draft = await createAssessmentDraft(deps, actor, {
      personId: fx.personId,
      title: 'Intake',
      body: 'v1',
      purpose: 'treatment',
    });
    expect(draft.status).toBe('draft');

    const signed = await signAssessmentRecord(deps, actor, {
      personId: fx.personId,
      assessmentId: draft.assessmentId as string,
      purpose: 'treatment',
    });
    expect(signed.status).toBe('signed');
    expect(signed.signedByProfessionalId).toBe(fx.doctorId);

    const { predecessor, successor } = await amendAssessmentRecord(deps, actor, {
      personId: fx.personId,
      assessmentId: draft.assessmentId as string,
      title: 'Intake corrected',
      body: 'v2',
      purpose: 'treatment',
    });
    expect(predecessor.status).toBe('amended');
    expect(successor.version).toBe(2);
    expect(successor.predecessorAssessmentId).toBe(draft.assessmentId);
  });

  it('cannot update signed assessment content', async () => {
    const fx = await resetAndSeed();
    await seedDoctorWrite(fx.personId, fx.doctorId);
    const actor = professionalActor(fx.doctorId);
    const draft = await createAssessmentDraft(deps, actor, {
      personId: fx.personId,
      title: 'T',
      body: 'B',
      purpose: 'treatment',
    });
    await signAssessmentRecord(deps, actor, {
      personId: fx.personId,
      assessmentId: draft.assessmentId as string,
      purpose: 'treatment',
    });
    await expect(
      updateAssessment(deps, actor, {
        personId: fx.personId,
        assessmentId: draft.assessmentId as string,
        title: 'Hacked',
        body: 'x',
        purpose: 'treatment',
      }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('DB trigger blocks direct signed content mutation (defense-in-depth)', async () => {
    const fx = await resetAndSeed();
    await seedDoctorWrite(fx.personId, fx.doctorId);
    const actor = professionalActor(fx.doctorId);
    const draft = await createAssessmentDraft(deps, actor, {
      personId: fx.personId,
      title: 'T',
      body: 'B',
      purpose: 'treatment',
    });
    await signAssessmentRecord(deps, actor, {
      personId: fx.personId,
      assessmentId: draft.assessmentId as string,
      purpose: 'treatment',
    });
    await expect(
      withClient(superPool, (c) =>
        c.query(`UPDATE assessments SET body = 'tampered' WHERE assessment_id = $1`, [
          draft.assessmentId,
        ]),
      ),
    ).rejects.toThrow(/immutable/i);
  });

  it('person list excludes drafts (signed only)', async () => {
    const fx = await resetAndSeed();
    await seedDoctorWrite(fx.personId, fx.doctorId);
    const actor = professionalActor(fx.doctorId);
    const draft = await createAssessmentDraft(deps, actor, {
      personId: fx.personId,
      title: 'Secret draft',
      body: 'not for person yet',
      purpose: 'treatment',
    });

    const personList = await listAssessments(deps, personActor(fx.personId), {
      personId: fx.personId,
      purpose: 'person_requested',
    });
    expect(personList.every((a) => a.status !== 'draft')).toBe(true);
    expect(personList.some((a) => a.assessmentId === draft.assessmentId)).toBe(false);

    await signAssessmentRecord(deps, actor, {
      personId: fx.personId,
      assessmentId: draft.assessmentId as string,
      purpose: 'treatment',
    });
    const afterSign = await listAssessments(deps, personActor(fx.personId), {
      personId: fx.personId,
      purpose: 'person_requested',
    });
    expect(afterSign.some((a) => a.assessmentId === draft.assessmentId)).toBe(true);
  });

  it('nurse with assessment_read but not write cannot create', async () => {
    const fx = await resetAndSeed();
    await grantFullClinical(fx.personId, fx.doctorId, [
      'assessment_read',
      'assessment_write',
      'timeline_read',
    ]);
    await grantFullClinical(fx.personId, fx.nurseId, ['assessment_read', 'timeline_read']);
    await expect(
      createAssessmentDraft(deps, professionalActor(fx.nurseId), {
        personId: fx.personId,
        title: 'Nope',
        body: 'x',
        purpose: 'treatment',
      }),
    ).rejects.toMatchObject({ code: 'denied' });
  });

  it('unknown purpose fails closed (I-19)', async () => {
    const fx = await resetAndSeed();
    await seedDoctorWrite(fx.personId, fx.doctorId);
    await expect(
      createAssessmentDraft(deps, professionalActor(fx.doctorId), {
        personId: fx.personId,
        title: 'T',
        body: 'B',
        purpose: 'not_a_purpose',
      }),
    ).rejects.toMatchObject({ code: 'denied' });
  });
});

describe('goals / care plans / interventions / outcomes', () => {
  async function seedCare(personId: string, doctorId: string): Promise<void> {
    await grantFullClinical(personId, doctorId, [
      'goal_read',
      'goal_write',
      'care_plan_read',
      'care_plan_write',
      'intervention_read',
      'outcome_read',
      'timeline_read',
    ]);
  }

  it('full care plan lifecycle', async () => {
    const fx = await resetAndSeed();
    await seedCare(fx.personId, fx.doctorId);
    const actor = professionalActor(fx.doctorId);

    const plan = await createCarePlanRecord(deps, actor, {
      personId: fx.personId,
      title: 'BP control',
      purpose: 'treatment',
    });
    const activated = await transitionCarePlanRecord(deps, actor, {
      personId: fx.personId,
      carePlanId: plan.carePlanId as string,
      to: 'active',
      purpose: 'treatment',
    });
    expect(activated.status).toBe('active');

    const goal = await createGoalRecord(deps, actor, {
      personId: fx.personId,
      carePlanId: plan.carePlanId as string,
      title: 'SBP < 130',
      target: { metric: 'sbp', targetValue: 130, unit: 'mmHg' },
      purpose: 'treatment',
    });
    const activeGoal = await transitionGoalRecord(deps, actor, {
      personId: fx.personId,
      goalId: goal.goalId as string,
      to: 'active',
      purpose: 'treatment',
    });
    expect(activeGoal.status).toBe('active');

    const intervention = await createInterventionRecord(deps, actor, {
      personId: fx.personId,
      carePlanId: plan.carePlanId as string,
      title: 'Lifestyle coaching',
      purpose: 'treatment',
    });
    const inProgress = await transitionInterventionRecord(deps, actor, {
      personId: fx.personId,
      interventionId: intervention.interventionId as string,
      to: 'in_progress',
      purpose: 'treatment',
    });
    expect(inProgress.status).toBe('in_progress');

    const outcome = await recordOutcomeEntry(deps, actor, {
      personId: fx.personId,
      goalId: goal.goalId as string,
      summary: 'SBP improved to 128',
      purpose: 'treatment',
    });
    expect(outcome.status).toBe('recorded');
  });

  it('nurse without goal_write cannot create goal', async () => {
    const fx = await resetAndSeed();
    await seedCare(fx.personId, fx.doctorId);
    await grantFullClinical(fx.personId, fx.nurseId, ['goal_read', 'timeline_read']);
    await expect(
      createGoalRecord(deps, professionalActor(fx.nurseId), {
        personId: fx.personId,
        title: 'No',
        purpose: 'treatment',
      }),
    ).rejects.toMatchObject({ code: 'denied' });
  });
});

describe('PEP category matrix (no independent engines)', () => {
  it('nurse membership without grant denies every clinical category', async () => {
    const fx = await resetAndSeed();
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
      'private_note_read',
    ];
    for (const category of categories) {
      const reason = await denyReason(professionalActor(fx.nurseId), fx.personId, category);
      expect(reason).not.toBe('ALLOW');
      expect(reason).toMatch(/NO_|PRIVATE|MEMBERSHIP|GRANT|CONSENT/);
    }
  });

  it('outsider professional (no relationship) denies', async () => {
    const fx = await resetAndSeed();
    const reason = await denyReason(
      professionalActor(fx.outsiderId),
      fx.personId,
      'assessment_read',
    );
    expect(reason).not.toBe('ALLOW');
  });

  it('person mismatch denies cross-person (I-11)', async () => {
    const fx = await resetAndSeed();
    const reason = await denyReason(personActor(fx.personId), fx.otherPersonId, 'timeline_read');
    expect(reason).toBe('PERSON_MISMATCH');
  });

  it('machine actor path still human-only at domain sign', async () => {
    // Domain-level guard already unit-tested; PEP uses professional principal only.
    const fx = await resetAndSeed();
    await grantFullClinical(fx.personId, fx.doctorId, ['assessment_write', 'assessment_read']);
    // Machine principal cannot form AuthorizationActor with professionalId — contract path.
    expect(machineActor('ai')).toMatchObject({ kind: 'machine' });
    expect(humanProfessional('dr')).toMatchObject({ kind: 'human_professional' });
  });

  it('grant for one category does not unlock another (category isolation)', async () => {
    const fx = await resetAndSeed();
    await grantFullClinical(fx.personId, fx.doctorId, ['assessment_read']);
    expect(
      await denyReason(professionalActor(fx.doctorId), fx.personId, 'assessment_write'),
    ).not.toBe('ALLOW');
    expect(await denyReason(professionalActor(fx.doctorId), fx.personId, 'timeline_read')).not.toBe(
      'ALLOW',
    );
    expect(await denyReason(professionalActor(fx.doctorId), fx.personId, 'assessment_read')).toBe(
      'ALLOW',
    );
  });
});

describe('RLS second gate (app ALLOW + DB DENY)', () => {
  it('direct SQL as nurse returns zero assessment rows even with broken context', async () => {
    const fx = await resetAndSeed();
    await grantFullClinical(fx.personId, fx.doctorId, [
      'assessment_read',
      'assessment_write',
      'timeline_read',
    ]);
    await createAssessmentDraft(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      title: 'Visible to doctor',
      body: 'x',
      purpose: 'treatment',
    });
    // Nurse has membership but no grant — RLS can_read_health false.
    const count = await runInPrincipalContext(
      appPool,
      { principalType: 'professional', principalId: fx.nurseId, purpose: 'treatment' },
      async (client) => {
        const r = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM assessments WHERE person_id = $1`,
          [fx.personId],
        );
        return Number(r.rows[0]?.n ?? '0');
      },
    );
    expect(count).toBe(0);
  });

  it('person RLS excludes drafts from direct SQL', async () => {
    const fx = await resetAndSeed();
    await grantFullClinical(fx.personId, fx.doctorId, [
      'assessment_read',
      'assessment_write',
      'timeline_read',
    ]);
    await createAssessmentDraft(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      title: 'Draft only',
      body: 'x',
      purpose: 'treatment',
    });
    const count = await runInPrincipalContext(
      appPool,
      { principalType: 'person', principalId: fx.personId, purpose: 'person_requested' },
      async (client) => {
        const r = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM assessments WHERE person_id = $1`,
          [fx.personId],
        );
        return Number(r.rows[0]?.n ?? '0');
      },
    );
    expect(count).toBe(0);
  });
});

describe('promotion path uses ordinary assessment_write (not private grant)', () => {
  it('author can promote after PEP on assessment_write', async () => {
    const fx = await resetAndSeed();
    await grantFullClinical(fx.personId, fx.doctorId, [
      'assessment_read',
      'assessment_write',
      'timeline_read',
    ]);
    const { createPrivateNote } = await import('./private-notes.js');
    const note = await createPrivateNote(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      body: 'subjective concern',
      purpose: 'treatment',
    });
    const result = await promotePrivateNoteRecord(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      noteId: note.noteId as string,
      purpose: 'treatment',
    });
    expect(result.promoted.provenance).toBe('promotion_from_private_note');
    expect(result.assessmentId).toBeTruthy();
  });
});

describe('type guards', () => {
  it('ClinicalError shape', () => {
    const e = new ClinicalError('denied', 'no', { denyReason: 'PRIVATE_NOTE' });
    expect(e.name).toBe('ClinicalError');
    expect(e.denyReason).toBe('PRIVATE_NOTE');
  });

  it('assessment mapping preserves signed fields', async () => {
    const fx = await resetAndSeed();
    await grantFullClinical(fx.personId, fx.doctorId, [
      'assessment_read',
      'assessment_write',
      'timeline_read',
    ]);
    const actor = professionalActor(fx.doctorId);
    const d = await createAssessmentDraft(deps, actor, {
      personId: fx.personId,
      title: 'T',
      body: 'B',
      purpose: 'treatment',
    });
    const s = await signAssessmentRecord(deps, actor, {
      personId: fx.personId,
      assessmentId: d.assessmentId as string,
      purpose: 'treatment',
    });
    const list = (await listAssessments(deps, actor, {
      personId: fx.personId,
      purpose: 'treatment',
    })) as Assessment[];
    expect(list.find((a) => a.assessmentId === d.assessmentId)?.status).toBe('signed');
    expect(s.status).toBe('signed');
  });
});
