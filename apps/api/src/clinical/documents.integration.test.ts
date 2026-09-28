/**
 * Phase 6 documents integration — lifecycle, quarantine, HIGH handling,
 * PEP+RLS dual gate, no destructive delete, checksum integrity.
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
  advanceDocumentScan,
  downloadDocument,
  getDocumentMetadata,
  MemoryDocumentStorage,
  uploadDocument,
  type ClinicalDeps,
} from './index.js';

const superDsn = defaultTestDsn('postgres');
const appDsn = defaultTestDsn('app');

let superPool: Pool;
let appPool: Pool;
let deps: ClinicalDeps;
let authzDeps: AuthorizationDeps;
let storage: MemoryDocumentStorage;

interface Fixture {
  personId: string;
  doctorId: string;
  nurseId: string;
}

async function resetAndSeed(): Promise<Fixture> {
  storage = new MemoryDocumentStorage();
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
      assessments,
      observations,
      care_team_memberships,
      care_teams
      CASCADE`);
    const person = await c.query<{ person_id: string }>(
      `INSERT INTO persons (display_name, is_adult) VALUES ('Doc Person', true) RETURNING person_id`,
    );
    const doctor = await c.query<{ professional_id: string }>(
      `INSERT INTO professionals (display_name) VALUES ('Doc Doctor') RETURNING professional_id`,
    );
    const nurse = await c.query<{ professional_id: string }>(
      `INSERT INTO professionals (display_name) VALUES ('Doc Nurse') RETURNING professional_id`,
    );
    const personId = person.rows[0]?.person_id ?? '';
    const doctorId = doctor.rows[0]?.professional_id ?? '';
    const nurseId = nurse.rows[0]?.professional_id ?? '';
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
    return { personId, doctorId, nurseId };
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
    accountId: 'p',
    personId: id,
    professionalId: null,
    emailNormalized: 'p@example.com',
  };
}

async function grantDocument(personId: string, doctorId: string): Promise<void> {
  const actor: ConsentActor = {
    accountId: 'acct-p',
    personId,
    professionalId: null,
    emailNormalized: 'p@example.com',
  };
  await issuePersonConsent(authzDeps as never, actor, {
    granteeProfessionalId: doctorId,
    scope: {
      categories: ['document_read'] as never,
      purposes: ['treatment'] as never,
    },
  });
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

describe('document lifecycle', () => {
  it('upload → pending_scan → available → download', async () => {
    const fx = await resetAndSeed();
    await grantDocument(fx.personId, fx.doctorId);
    const actor = professionalActor(fx.doctorId);
    const bytes = new TextEncoder().encode('lab report pdf bytes');
    const doc = await uploadDocument(deps, actor, storage, {
      personId: fx.personId,
      title: 'Lipid panel',
      contentType: 'application/pdf',
      bytes,
      purpose: 'treatment',
    });
    expect(doc.status).toBe('initialized');
    expect(doc.scanStatus).toBe('pending');

    const pending = await advanceDocumentScan(deps, actor, {
      personId: fx.personId,
      documentId: doc.documentId as string,
      to: 'pending_scan',
      purpose: 'treatment',
    });
    expect(pending.status).toBe('pending_scan');

    const available = await advanceDocumentScan(deps, actor, {
      personId: fx.personId,
      documentId: doc.documentId as string,
      to: 'available',
      purpose: 'treatment',
    });
    expect(available.status).toBe('available');
    expect(available.scanStatus).toBe('clean');

    const download = await downloadDocument(deps, actor, storage, {
      personId: fx.personId,
      documentId: doc.documentId as string,
      purpose: 'treatment',
    });
    expect(new TextDecoder().decode(download.bytes)).toBe('lab report pdf bytes');
    expect(download.highSensitivity).toBe(false);
  });

  it('quarantine blocks download', async () => {
    const fx = await resetAndSeed();
    await grantDocument(fx.personId, fx.doctorId);
    const actor = professionalActor(fx.doctorId);
    const doc = await uploadDocument(deps, actor, storage, {
      personId: fx.personId,
      title: 'Suspicious',
      contentType: 'application/pdf',
      bytes: new Uint8Array([1, 2, 3]),
      purpose: 'treatment',
    });
    await advanceDocumentScan(deps, actor, {
      personId: fx.personId,
      documentId: doc.documentId as string,
      to: 'pending_scan',
      purpose: 'treatment',
    });
    await advanceDocumentScan(deps, actor, {
      personId: fx.personId,
      documentId: doc.documentId as string,
      to: 'quarantined',
      purpose: 'treatment',
    });
    await expect(
      downloadDocument(deps, actor, storage, {
        personId: fx.personId,
        documentId: doc.documentId as string,
        purpose: 'treatment',
      }),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('HIGH_SENSITIVITY download is server-mediated with flag', async () => {
    const fx = await resetAndSeed();
    await grantDocument(fx.personId, fx.doctorId);
    const actor = professionalActor(fx.doctorId);
    const doc = await uploadDocument(deps, actor, storage, {
      personId: fx.personId,
      title: 'STI panel',
      contentType: 'application/pdf',
      dataClass: 'HIGH_SENSITIVITY',
      bytes: new TextEncoder().encode('high sens'),
      purpose: 'treatment',
    });
    expect(doc.dataClass).toBe('HIGH_SENSITIVITY');
    // Metadata never includes storage key exposure to caller beyond domain object;
    // download returns bytes only.
    await advanceDocumentScan(deps, actor, {
      personId: fx.personId,
      documentId: doc.documentId as string,
      to: 'pending_scan',
      purpose: 'treatment',
    });
    await advanceDocumentScan(deps, actor, {
      personId: fx.personId,
      documentId: doc.documentId as string,
      to: 'available',
      purpose: 'treatment',
    });
    const download = await downloadDocument(deps, actor, storage, {
      personId: fx.personId,
      documentId: doc.documentId as string,
      purpose: 'treatment',
    });
    expect(download.highSensitivity).toBe(true);
    expect(download.bytes.byteLength).toBeGreaterThan(0);
  });

  it('checksum mismatch rejects download', async () => {
    const fx = await resetAndSeed();
    await grantDocument(fx.personId, fx.doctorId);
    const actor = professionalActor(fx.doctorId);
    const doc = await uploadDocument(deps, actor, storage, {
      personId: fx.personId,
      title: 'Tamper',
      contentType: 'text/plain',
      bytes: new TextEncoder().encode('original'),
      purpose: 'treatment',
    });
    await advanceDocumentScan(deps, actor, {
      personId: fx.personId,
      documentId: doc.documentId as string,
      to: 'pending_scan',
      purpose: 'treatment',
    });
    await advanceDocumentScan(deps, actor, {
      personId: fx.personId,
      documentId: doc.documentId as string,
      to: 'available',
      purpose: 'treatment',
    });
    // Corrupt storage behind the port.
    await storage.put(doc.storageKey, new TextEncoder().encode('corrupted'));
    await expect(
      downloadDocument(deps, actor, storage, {
        personId: fx.personId,
        documentId: doc.documentId as string,
        purpose: 'treatment',
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('nurse without document_read grant cannot upload', async () => {
    const fx = await resetAndSeed();
    await grantDocument(fx.personId, fx.doctorId);
    await expect(
      uploadDocument(deps, professionalActor(fx.nurseId), storage, {
        personId: fx.personId,
        title: 'No',
        contentType: 'application/pdf',
        bytes: new Uint8Array([0]),
        purpose: 'treatment',
      }),
    ).rejects.toMatchObject({ code: 'denied' });
  });

  it('person can read own document metadata', async () => {
    const fx = await resetAndSeed();
    await grantDocument(fx.personId, fx.doctorId);
    const doc = await uploadDocument(deps, professionalActor(fx.doctorId), storage, {
      personId: fx.personId,
      title: 'Mine',
      contentType: 'text/plain',
      bytes: new TextEncoder().encode('x'),
      purpose: 'treatment',
    });
    const meta = await getDocumentMetadata(deps, personActor(fx.personId), {
      personId: fx.personId,
      documentId: doc.documentId as string,
      purpose: 'person_requested',
    });
    expect(meta.title).toBe('Mine');
  });

  it('RLS: direct SQL as nurse sees zero documents', async () => {
    const fx = await resetAndSeed();
    await grantDocument(fx.personId, fx.doctorId);
    await uploadDocument(deps, professionalActor(fx.doctorId), storage, {
      personId: fx.personId,
      title: 'Hidden',
      contentType: 'text/plain',
      bytes: new TextEncoder().encode('x'),
      purpose: 'treatment',
    });
    const count = await runInPrincipalContext(
      appPool,
      { principalType: 'professional', principalId: fx.nurseId, purpose: 'treatment' },
      async (client) => {
        const r = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM documents WHERE person_id = $1`,
          [fx.personId],
        );
        return Number(r.rows[0]?.n ?? '0');
      },
    );
    expect(count).toBe(0);
  });

  it('no DELETE policy: health_app cannot destroy documents', async () => {
    const fx = await resetAndSeed();
    await grantDocument(fx.personId, fx.doctorId);
    const doc = await uploadDocument(deps, professionalActor(fx.doctorId), storage, {
      personId: fx.personId,
      title: 'Keep',
      contentType: 'text/plain',
      bytes: new TextEncoder().encode('x'),
      purpose: 'treatment',
    });
    await expect(
      runInPrincipalContext(
        appPool,
        {
          principalType: 'professional',
          principalId: fx.doctorId,
          purpose: 'treatment',
        },
        (client) => client.query(`DELETE FROM documents WHERE document_id = $1`, [doc.documentId]),
      ),
    ).rejects.toThrow();
  });

  it('failed → pending_scan retry allowed', async () => {
    const fx = await resetAndSeed();
    await grantDocument(fx.personId, fx.doctorId);
    const actor = professionalActor(fx.doctorId);
    const doc = await uploadDocument(deps, actor, storage, {
      personId: fx.personId,
      title: 'Retry',
      contentType: 'text/plain',
      bytes: new TextEncoder().encode('x'),
      purpose: 'treatment',
    });
    await advanceDocumentScan(deps, actor, {
      personId: fx.personId,
      documentId: doc.documentId as string,
      to: 'pending_scan',
      purpose: 'treatment',
    });
    await advanceDocumentScan(deps, actor, {
      personId: fx.personId,
      documentId: doc.documentId as string,
      to: 'failed',
      purpose: 'treatment',
    });
    const retried = await advanceDocumentScan(deps, actor, {
      personId: fx.personId,
      documentId: doc.documentId as string,
      to: 'pending_scan',
      purpose: 'treatment',
    });
    expect(retried.status).toBe('pending_scan');
    expect(retried.scanStatus).toBe('pending');
  });
});
