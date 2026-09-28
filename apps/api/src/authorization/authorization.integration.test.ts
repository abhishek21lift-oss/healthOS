/**
 * Phase 5 authorization PEP integration — real PostgreSQL.
 * Covers: authorizeHealthAccess matrix, app+RLS dual gate, revocation SLA ≤5s
 * (measured), AccessRequest lifecycle via authorization layer, I-2/I-3 boundaries.
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
  authorizeHealthAccess,
  issuePersonConsent,
  revokePersonConsent,
  measureRevocationLatency,
  REVOCATION_SLA_MS,
  createPersonAccessRequest,
  resolvePersonAccessRequest,
  type AuthorizationActor,
  type AuthorizationDeps,
  type ConsentActor,
} from './index.js';

const superDsn = defaultTestDsn('postgres');
const appDsn = defaultTestDsn('app');

let superPool: Pool;
let appPool: Pool;
let deps: AuthorizationDeps;

interface Fixture {
  personId: string;
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
      care_team_memberships,
      care_teams,
      observations,
      assessments
      CASCADE`);
    const person = await c.query<{ person_id: string }>(
      `INSERT INTO persons (display_name, is_adult) VALUES ('Authz Person', true) RETURNING person_id`,
    );
    const doctor = await c.query<{ professional_id: string }>(
      `INSERT INTO professionals (display_name) VALUES ('Authz Doctor') RETURNING professional_id`,
    );
    const nurse = await c.query<{ professional_id: string }>(
      `INSERT INTO professionals (display_name) VALUES ('Authz Nurse') RETURNING professional_id`,
    );
    const personId = person.rows[0]?.person_id ?? '';
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
      `INSERT INTO person_professional_relationships
         (person_id, professional_id, care_team_id, collaboration_context, status)
       VALUES ($1, $2, $3, 'care_coordination', 'active')`,
      [personId, nurseId, careTeamId],
    );
    return { personId, doctorId, nurseId };
  });
}

function personActor(personId: string): ConsentActor {
  return {
    accountId: 'acct-person',
    personId,
    professionalId: null,
    emailNormalized: 'person@example.com',
  };
}

function professionalActor(professionalId: string): AuthorizationActor {
  return {
    accountId: 'acct-prof',
    personId: null,
    professionalId,
    emailNormalized: 'prof@example.com',
  };
}

function professionalConsentActor(professionalId: string): ConsentActor {
  return {
    accountId: 'acct-prof',
    personId: null,
    professionalId,
    emailNormalized: 'prof@example.com',
  };
}

async function canReadAs(principalId: string, personId: string, purpose: string): Promise<boolean> {
  return runInPrincipalContext(
    appPool,
    { principalType: 'professional', principalId, purpose },
    async (client) => {
      const r = await client.query<{ ok: boolean }>(
        `SELECT authz.can_read_health($1::uuid, 'timeline_read', $2::text) AS ok`,
        [personId, purpose],
      );
      return r.rows[0]?.ok === true;
    },
  );
}

beforeAll(async () => {
  superPool = createPool({ connectionString: superDsn, max: 4 });
  appPool = createPool({ connectionString: appDsn, max: 4 });
  await runMigrations(superPool);
  deps = { pool: appPool } as AuthorizationDeps;
}, 180_000);

beforeEach(async () => {
  await resetAndSeed();
});

afterAll(async () => {
  await superPool.end();
  await appPool.end();
});

describe('authorizeHealthAccess PEP matrix', () => {
  it('ALLOW only when relationship + membership + consent + grant all hold', async () => {
    const fx = await resetAndSeed();
    await issuePersonConsent(deps, personActor(fx.personId), {
      granteeProfessionalId: fx.doctorId,
      scope: { categories: ['timeline_read'], purposes: ['treatment'] },
    });
    const result = await authorizeHealthAccess(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      category: 'timeline_read',
      purpose: 'treatment',
    });
    expect(result.decision.allowed).toBe(true);
    expect(await canReadAs(fx.doctorId, fx.personId, 'treatment')).toBe(true);
  });

  it('DENY without consent/grant even with active membership (central acceptance)', async () => {
    const fx = await resetAndSeed();
    const result = await authorizeHealthAccess(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      category: 'timeline_read',
      purpose: 'treatment',
    });
    expect(result.decision.allowed).toBe(false);
    if (!result.decision.allowed) {
      expect(['NO_ACTIVE_CONSENT', 'NO_EFFECTIVE_GRANT']).toContain(result.decision.reason);
    }
    expect(await canReadAs(fx.doctorId, fx.personId, 'treatment')).toBe(false);
  });

  it('DENY on purpose mismatch (purpose not consented)', async () => {
    const fx = await resetAndSeed();
    await issuePersonConsent(deps, personActor(fx.personId), {
      granteeProfessionalId: fx.doctorId,
      scope: { categories: ['timeline_read'], purposes: ['treatment'] },
    });
    const result = await authorizeHealthAccess(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      category: 'timeline_read',
      purpose: 'care_coordination',
    });
    expect(result.decision.allowed).toBe(false);
    expect(await canReadAs(fx.doctorId, fx.personId, 'care_coordination')).toBe(false);
  });

  it('DENY when membership ended (relationship alone insufficient)', async () => {
    const fx = await resetAndSeed();
    await issuePersonConsent(deps, personActor(fx.personId), {
      granteeProfessionalId: fx.doctorId,
      scope: { categories: ['timeline_read'], purposes: ['treatment'] },
    });
    await withClient(superPool, (c) =>
      c.query(`UPDATE care_team_memberships SET status = 'ended' WHERE person_id = $1`, [
        fx.personId,
      ]),
    );
    const result = await authorizeHealthAccess(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      category: 'timeline_read',
      purpose: 'treatment',
    });
    expect(result.decision.allowed).toBe(false);
    expect(await canReadAs(fx.doctorId, fx.personId, 'treatment')).toBe(false);
  });

  it('person self-read allowed without grant; cross-person denied', async () => {
    const fx = await resetAndSeed();
    const self = await authorizeHealthAccess(deps, personActor(fx.personId), {
      personId: fx.personId,
      category: 'timeline_read',
      purpose: 'person_requested',
    });
    expect(self.decision.allowed).toBe(true);

    const other = await withClient(superPool, (c) =>
      c.query<{ person_id: string }>(
        `INSERT INTO persons (display_name, is_adult) VALUES ('Other Person', true) RETURNING person_id`,
      ),
    );
    const otherPersonId = other.rows[0]?.person_id ?? '';
    const cross = await authorizeHealthAccess(deps, personActor(fx.personId), {
      personId: otherPersonId,
      category: 'timeline_read',
      purpose: 'person_requested',
    });
    expect(cross.decision.allowed).toBe(false);
    if (!cross.decision.allowed) {
      expect(cross.decision.reason).toBe('PERSON_MISMATCH');
    }
  });

  it('I-3 org membership is never consulted — professional without grant denied', async () => {
    const fx = await resetAndSeed();
    // Nurse is on care team but has no consent/grant
    const result = await authorizeHealthAccess(deps, professionalActor(fx.nurseId), {
      personId: fx.personId,
      category: 'timeline_read',
      purpose: 'treatment',
    });
    expect(result.decision.allowed).toBe(false);
    expect(await canReadAs(fx.nurseId, fx.personId, 'treatment')).toBe(false);
  });

  it('fail-closed on missing purpose via service input boundary', async () => {
    const fx = await resetAndSeed();
    await expect(
      authorizeHealthAccess(deps, professionalActor(fx.doctorId), {
        personId: fx.personId,
        category: 'timeline_read',
        purpose: '',
      }),
    ).rejects.toMatchObject({ code: 'denied', denyReason: 'PURPOSE_REQUIRED' });
  });
});

describe('revocation propagation (I-9 ≤ 5s measured)', () => {
  it('consent revoke denies within SLA on immediate next probe', async () => {
    const fx = await resetAndSeed();
    await issuePersonConsent(deps, personActor(fx.personId), {
      granteeProfessionalId: fx.doctorId,
      scope: { categories: ['timeline_read'], purposes: ['treatment'] },
    });
    expect(
      (
        await authorizeHealthAccess(deps, professionalActor(fx.doctorId), {
          personId: fx.personId,
          category: 'timeline_read',
          purpose: 'treatment',
        })
      ).decision.allowed,
    ).toBe(true);

    const measured = await measureRevocationLatency(
      async () => {
        await revokePersonConsent(deps, personActor(fx.personId), {
          granteeProfessionalId: fx.doctorId,
        });
      },
      async () => {
        const r = await authorizeHealthAccess(deps, professionalActor(fx.doctorId), {
          personId: fx.personId,
          category: 'timeline_read',
          purpose: 'treatment',
        });
        return { allowed: r.decision.allowed };
      },
    );
    expect(measured.denied).toBe(true);
    expect(measured.withinSla).toBe(true);
    expect(measured.elapsedMs).toBeLessThanOrEqual(REVOCATION_SLA_MS);
    expect(await canReadAs(fx.doctorId, fx.personId, 'treatment')).toBe(false);
  });
});

describe('AccessRequest lifecycle via authorization layer', () => {
  it('pending request has zero health power; accept materializes grant', async () => {
    const fx = await resetAndSeed();
    const { accessRequestId } = await createPersonAccessRequest(
      deps,
      professionalConsentActor(fx.doctorId),
      {
        personId: fx.personId,
        scope: { categories: ['timeline_read'], purposes: ['treatment'] },
      },
    );
    expect(accessRequestId).toBeTruthy();
    const pending = await authorizeHealthAccess(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      category: 'timeline_read',
      purpose: 'treatment',
    });
    expect(pending.decision.allowed).toBe(false);

    const accepted = await resolvePersonAccessRequest(deps, personActor(fx.personId), {
      accessRequestId,
      decision: 'accept',
    });
    expect(accepted.consentIssued).toBe(true);
    const after = await authorizeHealthAccess(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      category: 'timeline_read',
      purpose: 'treatment',
    });
    expect(after.decision.allowed).toBe(true);
  });

  it('reject grants nothing', async () => {
    const fx = await resetAndSeed();
    const { accessRequestId } = await createPersonAccessRequest(
      deps,
      professionalConsentActor(fx.doctorId),
      {
        personId: fx.personId,
        scope: { categories: ['timeline_read'], purposes: ['treatment'] },
      },
    );
    const rejected = await resolvePersonAccessRequest(deps, personActor(fx.personId), {
      accessRequestId,
      decision: 'reject',
    });
    expect(rejected.status).toBe('rejected');
    expect(rejected.consentIssued).toBe(false);
    const d = await authorizeHealthAccess(deps, professionalActor(fx.doctorId), {
      personId: fx.personId,
      category: 'timeline_read',
      purpose: 'treatment',
    });
    expect(d.decision.allowed).toBe(false);
  });

  it('professional cannot issue consent (I-2)', async () => {
    const fx = await resetAndSeed();
    await expect(
      issuePersonConsent(deps, professionalConsentActor(fx.doctorId), {
        granteeProfessionalId: fx.doctorId,
        scope: { categories: ['timeline_read'], purposes: ['treatment'] },
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
