/**
 * Phase 6 private notes security matrix — I-4 author-only, I-5 exclusions.
 * Real PostgreSQL dual gate: PEP PRIVATE_NOTE deny + RLS can_access_private_note.
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

import {
  issuePersonConsent,
  type AuthorizationActor,
  type AuthorizationDeps,
  type ConsentActor,
} from '../authorization/index.js';
import {
  createPrivateNote,
  listPrivateNotes,
  promotePrivateNoteRecord,
  readPrivateNote,
  updatePrivateNoteRecord,
  voidPrivateNoteRecord,
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
  doctorId: string;
  nurseId: string;
  adminId: string;
  otherDoctorId: string;
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
      private_professional_notes,
      assessments,
      observations,
      care_team_memberships,
      care_teams,
      organization_memberships,
      organizations
      CASCADE`);
    const person = await c.query<{ person_id: string }>(
      `INSERT INTO persons (display_name, is_adult) VALUES ('Private Person', true) RETURNING person_id`,
    );
    const doctor = await c.query<{ professional_id: string }>(
      `INSERT INTO professionals (display_name) VALUES ('Dr Author') RETURNING professional_id`,
    );
    const nurse = await c.query<{ professional_id: string }>(
      `INSERT INTO professionals (display_name) VALUES ('N Other') RETURNING professional_id`,
    );
    const admin = await c.query<{ professional_id: string }>(
      `INSERT INTO professionals (display_name) VALUES ('Org Admin') RETURNING professional_id`,
    );
    const otherDoctor = await c.query<{ professional_id: string }>(
      `INSERT INTO professionals (display_name) VALUES ('Other Doctor') RETURNING professional_id`,
    );
    const personId = person.rows[0]?.person_id ?? '';
    const doctorId = doctor.rows[0]?.professional_id ?? '';
    const nurseId = nurse.rows[0]?.professional_id ?? '';
    const adminId = admin.rows[0]?.professional_id ?? '';
    const otherDoctorId = otherDoctor.rows[0]?.professional_id ?? '';
    const org = await c.query<{ organization_id: string }>(
      `INSERT INTO organizations (name) VALUES ('Private Clinic') RETURNING organization_id`,
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
    return { personId, doctorId, nurseId, adminId, otherDoctorId };
  });
}

function professionalActor(id: string): AuthorizationActor {
  return {
    accountId: 'acct',
    personId: null,
    professionalId: id,
    emailNormalized: `${id}@example.com`,
  };
}

function personActor(id: string): AuthorizationActor {
  return {
    accountId: 'acct-p',
    personId: id,
    professionalId: null,
    emailNormalized: 'p@example.com',
  };
}

function personConsentActor(id: string): ConsentActor {
  return {
    accountId: 'acct-p',
    personId: id,
    professionalId: null,
    emailNormalized: 'p@example.com',
  };
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

describe('private notes author-only (I-4)', () => {
  it('author creates and reads own note', async () => {
    const fx = await resetAndSeed();
    const note = await createPrivateNote(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      body: 'doctor private thought',
      purpose: 'treatment',
    });
    expect(note.dataClass).toBe('PROFESSIONAL_PRIVATE');
    const read = await readPrivateNote(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      noteId: note.noteId as string,
      purpose: 'treatment',
    });
    expect(read.body).toBe('doctor private thought');
  });

  it('non-author cannot read (not_found — no existence leak)', async () => {
    const fx = await resetAndSeed();
    const note = await createPrivateNote(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      body: 'confidential',
      purpose: 'treatment',
    });
    // Give nurse ordinary grants — still must not see private notes.
    await issuePersonConsent(authzDeps as never, personConsentActor(fx.personId), {
      granteeProfessionalId: fx.nurseId,
      scope: {
        categories: ['timeline_read', 'assessment_read', 'goal_read', 'document_read'] as never,
        purposes: ['treatment'] as never,
      },
    });
    await expect(
      readPrivateNote(deps, professionalActor(fx.nurseId), {
        personId: fx.personId,
        noteId: note.noteId as string,
        purpose: 'treatment',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('org admin cannot read private notes (I-4)', async () => {
    const fx = await resetAndSeed();
    const note = await createPrivateNote(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      body: 'admin must not see',
      purpose: 'treatment',
    });
    await expect(
      readPrivateNote(deps, professionalActor(fx.adminId), {
        personId: fx.personId,
        noteId: note.noteId as string,
        purpose: 'treatment',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('person cannot read private notes (I-4)', async () => {
    const fx = await resetAndSeed();
    const note = await createPrivateNote(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      body: 'not for person',
      purpose: 'treatment',
    });
    await expect(
      readPrivateNote(deps, personActor(fx.personId), {
        personId: fx.personId,
        noteId: note.noteId as string,
        purpose: 'person_requested',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('only author can update; non-author update fails', async () => {
    const fx = await resetAndSeed();
    const note = await createPrivateNote(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      body: 'original',
      purpose: 'treatment',
    });
    await expect(
      updatePrivateNoteRecord(deps, professionalActor(fx.nurseId), {
        personId: fx.personId,
        noteId: note.noteId as string,
        body: 'tampered',
        purpose: 'treatment',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('author voids note; voided note not editable', async () => {
    const fx = await resetAndSeed();
    const note = await createPrivateNote(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      body: 'to void',
      purpose: 'treatment',
    });
    const voided = await voidPrivateNoteRecord(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      noteId: note.noteId as string,
      purpose: 'treatment',
    });
    expect(voided.status).toBe('voided');
    await expect(
      updatePrivateNoteRecord(deps, professionalActor(fx.doctorId), {
        personId: fx.personId,
        noteId: note.noteId as string,
        body: 'nope',
        purpose: 'treatment',
      }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('listPrivateNotes returns only author rows under RLS', async () => {
    const fx = await resetAndSeed();
    await createPrivateNote(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      body: 'doc note',
      purpose: 'treatment',
    });
    await createPrivateNote(deps, professionalActor(fx.nurseId), {
      personId: fx.personId,
      body: 'nurse note',
      purpose: 'treatment',
    });
    const docNotes = await listPrivateNotes(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      purpose: 'treatment',
    });
    expect(docNotes).toHaveLength(1);
    expect(docNotes[0]?.body).toBe('doc note');
    const nurseNotes = await listPrivateNotes(deps, professionalActor(fx.nurseId), {
      personId: fx.personId,
      purpose: 'treatment',
    });
    expect(nurseNotes).toHaveLength(1);
    expect(nurseNotes[0]?.body).toBe('nurse note');
  });

  it('PEP denies private_note_read via ordinary grant path', async () => {
    const fx = await resetAndSeed();
    // Even with full ordinary grants, private_note_read must not ALLOW via AccessGrant.
    await issuePersonConsent(authzDeps as never, personConsentActor(fx.personId), {
      granteeProfessionalId: fx.nurseId,
      scope: {
        categories: ['timeline_read', 'assessment_read', 'document_read'] as never,
        purposes: ['treatment'] as never,
      },
    });
    // Compiler never emits private_note_read — nurse still cannot read doctor's note.
    const note = await createPrivateNote(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      body: 'x',
      purpose: 'treatment',
    });
    await expect(
      readPrivateNote(deps, professionalActor(fx.nurseId), {
        personId: fx.personId,
        noteId: note.noteId as string,
        purpose: 'treatment',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('private notes excluded from shared structures (I-5 structural)', () => {
  it('handoff_items ref_kind CHECK rejects private_note', async () => {
    const fx = await resetAndSeed();
    const handoff = await withClient(superPool, async (c) => {
      const h = await c.query<{ handoff_id: string }>(
        `INSERT INTO handoffs (person_id, sender_professional_id, receiver_professional_id, summary)
         VALUES ($1, $2, $3, 's') RETURNING handoff_id`,
        [fx.personId, fx.doctorId, fx.otherDoctorId],
      );
      return h.rows[0]?.handoff_id ?? '';
    });
    await expect(
      withClient(superPool, (c) =>
        c.query(
          `INSERT INTO handoff_items (handoff_id, ref_kind, ref_id)
           VALUES ($1, 'private_note', gen_random_uuid())`,
          [handoff],
        ),
      ),
    ).rejects.toThrow();
  });

  it('promotion creates shared assessment; original remains private', async () => {
    const fx = await resetAndSeed();
    await issuePersonConsent(authzDeps as never, personConsentActor(fx.personId), {
      granteeProfessionalId: fx.doctorId,
      scope: {
        categories: ['assessment_read', 'assessment_write', 'timeline_read'] as never,
        purposes: ['treatment'] as never,
      },
    });
    const note = await createPrivateNote(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      body: 'promote me',
      purpose: 'treatment',
    });
    const { promoted, assessmentId } = await promotePrivateNoteRecord(
      deps,
      professionalActor(fx.doctorId),
      {
        personId: fx.personId,
        noteId: note.noteId as string,
        purpose: 'treatment',
      },
    );
    expect(assessmentId).toBeTruthy();
    expect(promoted.body).toBe('promote me');
    // Original still private class.
    const still = await readPrivateNote(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      noteId: note.noteId as string,
      purpose: 'treatment',
    });
    expect(still.dataClass).toBe('PROFESSIONAL_PRIVATE');
    // Shared copy visible as assessment.
    const assessments = await runInPrincipalContext(
      appPool,
      { principalType: 'professional', principalId: fx.doctorId, purpose: 'treatment' },
      async (client) => {
        const r = await client.query<{ title: string }>(
          `SELECT title FROM assessments WHERE assessment_id = $1`,
          [assessmentId],
        );
        return r.rows;
      },
    );
    expect(assessments[0]?.title).toBe('Promoted private note');
  });
});
