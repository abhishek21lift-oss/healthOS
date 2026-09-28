/**
 * Phase 7 timeline integration — real PostgreSQL.
 * Proves: projection, private-note exclusion, draft exclusion, amendment lineage,
 * read-time authz + revocation, cross-person isolation, keyset pagination, rebuild, RLS.
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
import { isPrivateNoteSourceType } from '@health-os/domain';

import {
  issuePersonConsent,
  revokeConsentWithPropagation,
  type AuthorizationActor,
  type AuthorizationDeps,
  type ConsentActor,
} from '../authorization/index.js';
import {
  amendAssessmentRecord,
  createAssessmentDraft,
  createObservation,
  signAssessmentRecord,
  type ClinicalDeps,
} from '../clinical/index.js';
import {
  listTimeline,
  rebuildPersonTimeline,
  syncPersonTimeline,
  processTimelineOutbox,
  timelineEntryId,
  type TimelineDeps,
} from './index.js';

const superDsn = defaultTestDsn('postgres');
const appDsn = defaultTestDsn('app');

let superPool: Pool;
let appPool: Pool;
let deps: TimelineDeps;
let clinicalDeps: ClinicalDeps;
let authzDeps: AuthorizationDeps;

interface Fixture {
  personId: string;
  otherPersonId: string;
  doctorId: string;
  nurseId: string;
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
      timeline_entries,
      outbox_events,
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
      `INSERT INTO persons (display_name, is_adult) VALUES ('Timeline Person', true) RETURNING person_id`,
    );
    const other = await c.query<{ person_id: string }>(
      `INSERT INTO persons (display_name, is_adult) VALUES ('Other Timeline', true) RETURNING person_id`,
    );
    const doctor = await c.query<{ professional_id: string }>(
      `INSERT INTO professionals (display_name) VALUES ('Timeline Doctor') RETURNING professional_id`,
    );
    const nurse = await c.query<{ professional_id: string }>(
      `INSERT INTO professionals (display_name) VALUES ('Timeline Nurse') RETURNING professional_id`,
    );
    const personId = person.rows[0]?.person_id ?? '';
    const otherPersonId = other.rows[0]?.person_id ?? '';
    const doctorId = doctor.rows[0]?.professional_id ?? '';
    const nurseId = nurse.rows[0]?.professional_id ?? '';
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
      `INSERT INTO private_professional_notes
         (person_id, author_professional_id, status, data_class, body)
       VALUES ($1, $2, 'active', 'PROFESSIONAL_PRIVATE', 'secret note body')`,
      [personId, doctorId],
    );
    return { personId, otherPersonId, doctorId, nurseId };
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

async function grantTimeline(
  personId: string,
  doctorId: string,
  categories: readonly string[] = ['timeline_read', 'assessment_write', 'assessment_read'],
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

beforeAll(async () => {
  superPool = createPool({ connectionString: superDsn, max: 4 });
  appPool = createPool({ connectionString: appDsn, max: 4 });
  await runMigrations(superPool);
  deps = { pool: appPool } as TimelineDeps;
  clinicalDeps = { pool: appPool } as ClinicalDeps;
  authzDeps = { pool: appPool } as AuthorizationDeps;
}, 180_000);

beforeEach(async () => {
  await resetAndSeed();
});

afterAll(async () => {
  await superPool.end();
  await appPool.end();
});

describe('projection sources', () => {
  it('projects signed assessment and observation; never private note or draft', async () => {
    const fx = await resetAndSeed();
    await grantTimeline(fx.personId, fx.doctorId);
    const doctor = professionalActor(fx.doctorId);

    const draft = await createAssessmentDraft(clinicalDeps, doctor, {
      personId: fx.personId,
      title: 'Draft note',
      body: 'draft body',
      purpose: 'treatment',
    });
    await createObservation(clinicalDeps, doctor, {
      personId: fx.personId,
      code: 'heart_rate',
      valueNumeric: 70,
      unit: 'bpm',
      purpose: 'treatment',
    });

    await rebuildPersonTimeline(appPool, fx.personId);
    let page = await listTimeline(deps, doctor, {
      personId: fx.personId,
      purpose: 'treatment',
      sync: false,
    });
    const types = page.entries.map((e) => e.eventType);
    expect(types).toContain('observation_recorded');
    expect(types).not.toContain('assessment_signed');
    expect(page.entries.some((e) => e.sourceType === 'assessment')).toBe(false);
    expect(JSON.stringify(page.entries).includes('secret note body')).toBe(false);
    expect(page.entries.some((e) => isPrivateNoteSourceType(e.sourceType))).toBe(false);

    await signAssessmentRecord(clinicalDeps, doctor, {
      personId: fx.personId,
      assessmentId: draft.assessmentId,
      purpose: 'treatment',
    });
    page = await listTimeline(deps, doctor, {
      personId: fx.personId,
      purpose: 'treatment',
    });
    expect(page.entries.some((e) => e.eventType === 'assessment_signed')).toBe(true);
  });

  it('amendment lineage preserved on projection', async () => {
    const fx = await resetAndSeed();
    await grantTimeline(fx.personId, fx.doctorId);
    const doctor = professionalActor(fx.doctorId);
    const draft = await createAssessmentDraft(clinicalDeps, doctor, {
      personId: fx.personId,
      title: 'v1',
      body: 'b1',
      purpose: 'treatment',
    });
    await signAssessmentRecord(clinicalDeps, doctor, {
      personId: fx.personId,
      assessmentId: draft.assessmentId,
      purpose: 'treatment',
    });
    const { predecessor } = await amendAssessmentRecord(clinicalDeps, doctor, {
      personId: fx.personId,
      assessmentId: draft.assessmentId,
      title: 'v2',
      body: 'b2',
      purpose: 'treatment',
    });
    await rebuildPersonTimeline(appPool, fx.personId);
    const page = await listTimeline(deps, doctor, {
      personId: fx.personId,
      purpose: 'treatment',
      sync: false,
    });
    const amended = page.entries.find((e) => e.sourceId === predecessor.assessmentId);
    expect(amended?.eventType).toBe('assessment_amended');
    // First-generation amended row has null predecessor; lineage is the successor link.
    const lineage = await superPool.query<{ predecessor_assessment_id: string | null }>(
      `SELECT predecessor_assessment_id FROM assessments
       WHERE predecessor_assessment_id = $1`,
      [predecessor.assessmentId],
    );
    expect(lineage.rows[0]?.predecessor_assessment_id).toBe(predecessor.assessmentId);
    const signedSuccessor = page.entries.find(
      (e) => e.sourceType === 'assessment' && e.eventType === 'assessment_signed',
    );
    expect(signedSuccessor).toBeUndefined();
  });

  it('deterministic identity: same source ⇒ same entry id; rebuild idempotent', async () => {
    const fx = await resetAndSeed();
    await grantTimeline(fx.personId, fx.doctorId);
    const doctor = professionalActor(fx.doctorId);
    await createObservation(clinicalDeps, doctor, {
      personId: fx.personId,
      code: 'hr',
      valueNumeric: 60,
      purpose: 'treatment',
    });
    const n1 = await rebuildPersonTimeline(appPool, fx.personId);
    const page1 = await listTimeline(deps, doctor, {
      personId: fx.personId,
      purpose: 'treatment',
      sync: false,
    });
    const n2 = await rebuildPersonTimeline(appPool, fx.personId);
    const page2 = await listTimeline(deps, doctor, {
      personId: fx.personId,
      purpose: 'treatment',
      sync: false,
    });
    expect(n1).toBe(n2);
    expect(page1.entries.map((e) => e.timelineEntryId)).toEqual(
      page2.entries.map((e) => e.timelineEntryId),
    );
    const first = page1.entries[0];
    expect(first).toBeDefined();
    if (first !== undefined) {
      expect(first.timelineEntryId).toBe(
        timelineEntryId(first.personId, first.sourceType, first.sourceId),
      );
    }
    // Orphan prevention: extra manual row removed on sync
    await withClient(superPool, async (c) => {
      await c.query(
        `INSERT INTO timeline_entries
           (timeline_entry_id, person_id, event_type, source_type, source_id, event_at)
         VALUES ($1, $2, 'observation_recorded', 'observation', $3, now())
         ON CONFLICT DO NOTHING`,
        [
          timelineEntryId(fx.personId, 'observation', '11111111-1111-1111-1111-111111111111'),
          fx.personId,
          '11111111-1111-1111-1111-111111111111',
        ],
      );
    });
    await syncPersonTimeline(appPool, fx.personId);
    const after = await withClient(superPool, (c) =>
      c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM timeline_entries
         WHERE person_id = $1 AND source_id = '11111111-1111-1111-1111-111111111111'`,
        [fx.personId],
      ),
    );
    expect(after.rows[0]?.n).toBe('0');
  });

  it('outbox drain marks done and is idempotent', async () => {
    const fx = await resetAndSeed();
    await grantTimeline(fx.personId, fx.doctorId);
    const doctor = professionalActor(fx.doctorId);
    await createObservation(clinicalDeps, doctor, {
      personId: fx.personId,
      code: 'bp',
      valueNumeric: 120,
      purpose: 'treatment',
    });
    const processed = await processTimelineOutbox(appPool);
    expect(processed).toBeGreaterThanOrEqual(1);
    const again = await processTimelineOutbox(appPool);
    expect(again).toBe(0);
    const pending = await withClient(superPool, (c) =>
      c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM outbox_events
         WHERE event_type = 'timeline.project' AND status = 'pending'`,
      ),
    );
    expect(pending.rows[0]?.n).toBe('0');
  });
});

describe('authorization + isolation', () => {
  it('person self sees own timeline; cross-person denied', async () => {
    const fx = await resetAndSeed();
    await grantTimeline(fx.personId, fx.doctorId);
    const doctor = professionalActor(fx.doctorId);
    await createObservation(clinicalDeps, doctor, {
      personId: fx.personId,
      code: 'hr',
      valueNumeric: 70,
      purpose: 'treatment',
    });
    await rebuildPersonTimeline(appPool, fx.personId);
    const selfPage = await listTimeline(deps, personActor(fx.personId), {
      personId: fx.personId,
      purpose: 'treatment',
      sync: false,
    });
    expect(selfPage.entries.length).toBeGreaterThan(0);

    await expect(
      listTimeline(deps, personActor(fx.otherPersonId), {
        personId: fx.personId,
        purpose: 'treatment',
        sync: false,
      }),
    ).rejects.toThrow();
  });

  it('relationship without consent cannot read timeline', async () => {
    const fx = await resetAndSeed();
    const nurse = professionalActor(fx.nurseId);
    await createObservation(clinicalDeps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      code: 'hr',
      valueNumeric: 70,
      purpose: 'treatment',
    }).catch(() => undefined);
    // doctor without grant cannot create either
    await expect(
      listTimeline(deps, nurse, {
        personId: fx.personId,
        purpose: 'treatment',
        sync: false,
      }),
    ).rejects.toThrow();
  });

  it('revocation immediately denies timeline read (stale projection does not preserve access)', async () => {
    const fx = await resetAndSeed();
    await grantTimeline(fx.personId, fx.doctorId);
    const doctor = professionalActor(fx.doctorId);
    await createObservation(clinicalDeps, doctor, {
      personId: fx.personId,
      code: 'hr',
      valueNumeric: 70,
      purpose: 'treatment',
    });
    await rebuildPersonTimeline(appPool, fx.personId);
    const before = await listTimeline(deps, doctor, {
      personId: fx.personId,
      purpose: 'treatment',
      sync: false,
    });
    expect(before.entries.length).toBeGreaterThan(0);

    const personConsentActor: ConsentActor = {
      accountId: 'acct-p',
      personId: fx.personId,
      professionalId: null,
      emailNormalized: 'p@example.com',
    };
    await revokeConsentWithPropagation(authzDeps, personConsentActor, {
      granteeProfessionalId: fx.doctorId,
    });

    await expect(
      listTimeline(deps, doctor, {
        personId: fx.personId,
        purpose: 'treatment',
        sync: false,
      }),
    ).rejects.toThrow();

    // Re-grant restores
    await grantTimeline(fx.personId, fx.doctorId);
    const after = await listTimeline(deps, doctor, {
      personId: fx.personId,
      purpose: 'treatment',
      sync: false,
    });
    expect(after.entries.length).toBeGreaterThan(0);
  });

  it('empty purpose fails closed', async () => {
    const fx = await resetAndSeed();
    await expect(
      listTimeline(deps, personActor(fx.personId), {
        personId: fx.personId,
        purpose: '   ',
        sync: false,
      }),
    ).rejects.toThrow(/purpose/i);
  });

  it('wrong purpose denied', async () => {
    const fx = await resetAndSeed();
    await grantTimeline(fx.personId, fx.doctorId);
    await expect(
      listTimeline(deps, professionalActor(fx.doctorId), {
        personId: fx.personId,
        purpose: 'billing',
        sync: false,
      }),
    ).rejects.toThrow();
  });
});

describe('keyset pagination', () => {
  it('pages stably; rejects tampered and cross-person cursors', async () => {
    const fx = await resetAndSeed();
    await grantTimeline(fx.personId, fx.doctorId);
    const doctor = professionalActor(fx.doctorId);
    for (let i = 0; i < 5; i += 1) {
      await createObservation(clinicalDeps, doctor, {
        personId: fx.personId,
        code: `code_${String(i)}`,
        valueNumeric: 1,
        observedAt: 1_700_000_000_000 + i * 1000,
        purpose: 'treatment',
      });
    }
    await rebuildPersonTimeline(appPool, fx.personId);
    const page1 = await listTimeline(deps, doctor, {
      personId: fx.personId,
      purpose: 'treatment',
      limit: 2,
      sync: false,
    });
    expect(page1.entries).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await listTimeline(deps, doctor, {
      personId: fx.personId,
      purpose: 'treatment',
      limit: 2,
      cursor: page1.nextCursor ?? '',
      sync: false,
    });
    expect(page2.entries).toHaveLength(2);
    const ids1 = new Set(page1.entries.map((e) => e.timelineEntryId));
    expect(page2.entries.every((e) => !ids1.has(e.timelineEntryId))).toBe(true);

    // Tampered cursor
    const bad = (page1.nextCursor ?? 'x.y') + 'tamper';
    await expect(
      listTimeline(deps, doctor, {
        personId: fx.personId,
        purpose: 'treatment',
        cursor: bad,
        sync: false,
      }),
    ).rejects.toThrow(/cursor/i);

    // Cross-person cursor reuse
    await expect(
      listTimeline(deps, personActor(fx.otherPersonId), {
        personId: fx.otherPersonId,
        purpose: 'treatment',
        cursor: page1.nextCursor ?? '',
        sync: false,
      }),
    ).rejects.toThrow();

    // Filter shape mismatch
    await expect(
      listTimeline(deps, doctor, {
        personId: fx.personId,
        purpose: 'treatment',
        cursor: page1.nextCursor ?? '',
        filters: { eventTypes: ['observation_recorded'] },
        sync: false,
      }),
    ).rejects.toThrow(/cursor/i);
  });
});

describe('RLS direct SQL', () => {
  it('health_app without context sees 0 timeline rows; person only self; system can write', async () => {
    const fx = await resetAndSeed();
    await grantTimeline(fx.personId, fx.doctorId);
    await createObservation(clinicalDeps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      code: 'hr',
      valueNumeric: 72,
      purpose: 'treatment',
    });
    await rebuildPersonTimeline(appPool, fx.personId);

    const noCtx = await withClient(appPool, (c) =>
      c.query(`SELECT timeline_entry_id FROM timeline_entries`),
    );
    expect(noCtx.rowCount).toBe(0);

    const asPerson = await runInPrincipalContext(
      appPool,
      { principalType: 'person', principalId: fx.personId, purpose: 'treatment' },
      (c) => c.query(`SELECT timeline_entry_id FROM timeline_entries`),
    );
    expect(asPerson.rowCount ?? 0).toBeGreaterThan(0);

    const asOtherPerson = await runInPrincipalContext(
      appPool,
      { principalType: 'person', principalId: fx.otherPersonId, purpose: 'treatment' },
      (c) => c.query(`SELECT timeline_entry_id FROM timeline_entries`),
    );
    expect(asOtherPerson.rowCount).toBe(0);

    // Professional without grant: 0 rows
    const asNurse = await runInPrincipalContext(
      appPool,
      { principalType: 'professional', principalId: fx.nurseId, purpose: 'treatment' },
      (c) => c.query(`SELECT timeline_entry_id FROM timeline_entries`),
    );
    expect(asNurse.rowCount).toBe(0);

    // health_app cannot insert as non-system principal
    await expect(
      runInPrincipalContext(
        appPool,
        { principalType: 'person', principalId: fx.personId, purpose: 'treatment' },
        (c) =>
          c.query(
            `INSERT INTO timeline_entries
               (timeline_entry_id, person_id, event_type, source_type, source_id, event_at)
             VALUES ($1, $2, 'observation_recorded', 'observation', $3, now())`,
            [
              '22222222-2222-2222-2222-222222222222',
              fx.personId,
              '33333333-3333-3333-3333-333333333333',
            ],
          ),
      ),
    ).rejects.toThrow();
  });
});

describe('performance smoke', () => {
  it('measures projection + first page + rebuild timings', async () => {
    const fx = await resetAndSeed();
    await grantTimeline(fx.personId, fx.doctorId);
    const doctor = professionalActor(fx.doctorId);
    const startInsert = Date.now();
    for (let i = 0; i < 50; i += 1) {
      await createObservation(clinicalDeps, doctor, {
        personId: fx.personId,
        code: `obs_${String(i)}`,
        valueNumeric: i,
        observedAt: 1_700_000_000_000 + i * 10,
        purpose: 'treatment',
      });
    }
    const insertMs = Date.now() - startInsert;

    const startRebuild = Date.now();
    await rebuildPersonTimeline(appPool, fx.personId);
    const rebuildMs = Date.now() - startRebuild;

    const startPage = Date.now();
    const page = await listTimeline(deps, doctor, {
      personId: fx.personId,
      purpose: 'treatment',
      limit: 20,
      sync: false,
    });
    const pageMs = Date.now() - startPage;
    expect(page.entries.length).toBe(20);
    expect(insertMs).toBeGreaterThanOrEqual(0);
    expect(rebuildMs).toBeGreaterThanOrEqual(0);
    expect(pageMs).toBeGreaterThanOrEqual(0);
    expect(insertMs).toBeLessThan(120_000);
    expect(rebuildMs).toBeLessThan(30_000);
    expect(pageMs).toBeLessThan(10_000);
  }, 180_000);
});
