/**
 * Phase 5 consent + AccessGrant compiler integration — real PostgreSQL.
 * Covers: issue → grants, revoke ≤ next request (I-9), purpose/category matrix,
 * AccessRequest no power while pending, audit (I-10), RLS write policies.
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
import { evaluateHealthAccess, type AccessEvaluationRequest } from '@health-os/permissions';

import {
  createPersonAccessRequest,
  issuePersonConsent,
  narrowPersonConsent,
  resolvePersonAccessRequest,
  revokePersonConsent,
  type ConsentActor,
  type ConsentAuditEntry,
  type ConsentDeps,
} from './index.js';

const superDsn = defaultTestDsn('postgres');
const appDsn = defaultTestDsn('app');

let superPool: Pool;
let appPool: Pool;
let deps: ConsentDeps;
let audits: ConsentAuditEntry[] = [];

interface Fixture {
  personId: string;
  doctorId: string;
  nurseId: string;
  careTeamId: string;
  doctorMembershipId: string;
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
      care_team_memberships,
      care_teams,
      observations,
      assessments
      CASCADE`);
    const person = await c.query<{ person_id: string }>(
      `INSERT INTO persons (display_name, is_adult) VALUES ('Phase5 Person', true) RETURNING person_id`,
    );
    const doctor = await c.query<{ professional_id: string }>(
      `INSERT INTO professionals (display_name) VALUES ('Phase5 Doctor') RETURNING professional_id`,
    );
    const nurse = await c.query<{ professional_id: string }>(
      `INSERT INTO professionals (display_name) VALUES ('Phase5 Nurse') RETURNING professional_id`,
    );
    const personId = person.rows[0]?.person_id ?? '';
    const doctorId = doctor.rows[0]?.professional_id ?? '';
    const nurseId = nurse.rows[0]?.professional_id ?? '';
    const team = await c.query<{ care_team_id: string }>(
      `INSERT INTO care_teams (person_id, status) VALUES ($1, 'open') RETURNING care_team_id`,
      [personId],
    );
    const careTeamId = team.rows[0]?.care_team_id ?? '';
    const doctorM = await c.query<{ membership_id: string }>(
      `INSERT INTO care_team_memberships (care_team_id, person_id, professional_id, status)
       VALUES ($1, $2, $3, 'active') RETURNING membership_id`,
      [careTeamId, personId, doctorId],
    );
    await c.query(
      `INSERT INTO care_team_memberships (care_team_id, person_id, professional_id, status)
       VALUES ($1, $2, $3, 'active')`,
      [careTeamId, personId, nurseId],
    );
    return {
      personId,
      doctorId,
      nurseId,
      careTeamId,
      doctorMembershipId: doctorM.rows[0]?.membership_id ?? '',
    };
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

function professionalActor(professionalId: string): ConsentActor {
  return {
    accountId: 'acct-prof',
    personId: null,
    professionalId,
    emailNormalized: 'prof@example.com',
  };
}

async function activeGrantCount(personId: string, granteeId: string): Promise<number> {
  // Superuser pool bypasses RLS for assertions (service writes run as system).
  const res = await withClient(superPool, (c) =>
    c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM access_grants
       WHERE person_id = $1 AND grantee_professional_id = $2 AND status = 'active'`,
      [personId, granteeId],
    ),
  );
  return Number(res.rows[0]?.n ?? '0');
}

async function canReadObservationAs(
  principalId: string,
  personId: string,
  purpose: string,
): Promise<boolean> {
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

function pevpRequest(
  personId: string,
  professionalId: string,
  overrides: Partial<AccessEvaluationRequest> = {},
): AccessEvaluationRequest {
  return {
    principal: { type: 'professional', id: professionalId },
    personId,
    category: 'timeline_read',
    purpose: 'treatment',
    roleAllows: true,
    membershipActive: true,
    grant: null,
    consentActive: true,
    at: Date.now(),
    ...overrides,
  };
}

async function loadActiveGrant(
  personId: string,
  granteeId: string,
  category: string,
  purpose: string,
): Promise<AccessEvaluationRequest['grant']> {
  const res = await withClient(superPool, (c) =>
    c.query<{
      access_grant_id: string;
      person_id: string;
      grantee_professional_id: string;
      category: string;
      purpose: string;
      status: string;
      relationship_class: string;
      membership_id: string | null;
      consent_revision_id: string | null;
      effective_from: Date;
      effective_until: Date | null;
      issued_at: Date;
    }>(
      `SELECT access_grant_id, person_id, grantee_professional_id, category, purpose,
              status, relationship_class, membership_id, consent_revision_id,
              effective_from, effective_until, issued_at
       FROM access_grants
       WHERE person_id = $1 AND grantee_professional_id = $2
         AND category = $3 AND purpose = $4`,
      [personId, granteeId, category, purpose],
    ),
  );
  const row = res.rows[0];
  if (row === undefined) {
    return null;
  }
  return {
    grantId: row.access_grant_id as never,
    personId: row.person_id as never,
    granteeProfessionalId: row.grantee_professional_id as never,
    category: row.category as never,
    purpose: row.purpose as never,
    status: row.status as never,
    relationship: row.relationship_class as never,
    membershipId: (row.membership_id ?? '') as never,
    consentRevisionId: (row.consent_revision_id ?? '') as never,
    window: {
      effectiveFrom: row.effective_from.getTime(),
      effectiveUntil: row.effective_until === null ? null : row.effective_until.getTime(),
    },
    issuedAt: row.issued_at.getTime(),
  };
}

beforeAll(async () => {
  superPool = createPool({ connectionString: superDsn, max: 4 });
  appPool = createPool({ connectionString: appDsn, max: 4 });
  await runMigrations(superPool);
  deps = {
    pool: appPool,
    onAudit: (e) => {
      audits.push(e);
    },
  } as ConsentDeps;
}, 180_000);

beforeEach(async () => {
  await resetAndSeed();
  audits = [];
});

afterAll(async () => {
  await superPool.end();
  await appPool.end();
});

describe('consent issue + grant compiler', () => {
  it('issues consent and compiles cartesian grants with active membership', async () => {
    const fx = await resetAndSeed();
    const result = await issuePersonConsent(deps, personActor(fx.personId), {
      granteeProfessionalId: fx.doctorId,
      scope: {
        categories: ['timeline_read', 'assessment_read'],
        purposes: ['treatment'],
      },
    });
    expect(result.grantCount).toBe(2);
    expect(await activeGrantCount(fx.personId, fx.doctorId)).toBe(2);
    expect(audits.some((a) => a.action === 'consent_issued')).toBe(true);

    // RLS can_read_health allows doctor with matching purpose
    expect(await canReadObservationAs(fx.doctorId, fx.personId, 'treatment')).toBe(true);
    // Wrong purpose fails closed
    expect(await canReadObservationAs(fx.doctorId, fx.personId, 'care_coordination')).toBe(false);
  });

  it('does not compile grants without care team membership', async () => {
    const fx = await resetAndSeed();
    // Doctor has membership in seed; remove it
    await withClient(superPool, (c) =>
      c.query(`UPDATE care_team_memberships SET status = 'ended' WHERE person_id = $1`, [
        fx.personId,
      ]),
    );
    const result = await issuePersonConsent(deps, personActor(fx.personId), {
      granteeProfessionalId: fx.doctorId,
      scope: { categories: ['timeline_read'], purposes: ['treatment'] },
    });
    expect(result.grantCount).toBe(0);
    expect(await activeGrantCount(fx.personId, fx.doctorId)).toBe(0);
    expect(await canReadObservationAs(fx.doctorId, fx.personId, 'treatment')).toBe(false);
  });

  it('rejects double issue of active consent', async () => {
    const fx = await resetAndSeed();
    await issuePersonConsent(deps, personActor(fx.personId), {
      granteeProfessionalId: fx.doctorId,
      scope: { categories: ['timeline_read'], purposes: ['treatment'] },
    });
    await expect(
      issuePersonConsent(deps, personActor(fx.personId), {
        granteeProfessionalId: fx.doctorId,
        scope: { categories: ['goal_read'], purposes: ['treatment'] },
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('consent revoke (I-9 ≤ 5s / next request)', () => {
  it('revokes grants in the same transaction — deny on immediate next probe', async () => {
    const fx = await resetAndSeed();
    await issuePersonConsent(deps, personActor(fx.personId), {
      granteeProfessionalId: fx.doctorId,
      scope: {
        categories: ['timeline_read', 'assessment_read'],
        purposes: ['treatment'],
      },
    });
    expect(await canReadObservationAs(fx.doctorId, fx.personId, 'treatment')).toBe(true);
    expect(await activeGrantCount(fx.personId, fx.doctorId)).toBe(2);

    const started = Date.now();
    const result = await revokePersonConsent(deps, personActor(fx.personId), {
      granteeProfessionalId: fx.doctorId,
    });
    const elapsed = Date.now() - started;
    expect(result.revokedGrants).toBe(2);
    expect(elapsed).toBeLessThan(5000);

    expect(await activeGrantCount(fx.personId, fx.doctorId)).toBe(0);
    // Immediate next request denied (staleness 0, well under 5s)
    expect(await canReadObservationAs(fx.doctorId, fx.personId, 'treatment')).toBe(false);
    expect(audits.some((a) => a.action === 'consent_revoked')).toBe(true);

    const grants = await withClient(appPool, (c) =>
      c.query<{ status: string; revoked_at: Date | null }>(
        `SELECT status, revoked_at FROM access_grants WHERE person_id = $1`,
        [fx.personId],
      ),
    );
    expect(grants.rows.every((g) => g.status === 'revoked')).toBe(true);
    expect(grants.rows.every((g) => g.revoked_at !== null)).toBe(true);
  });

  it('only the person may revoke', async () => {
    const fx = await resetAndSeed();
    await issuePersonConsent(deps, personActor(fx.personId), {
      granteeProfessionalId: fx.doctorId,
      scope: { categories: ['timeline_read'], purposes: ['treatment'] },
    });
    // System path enforces domain rule via revokeConsent — non-person actor forbidden at API
    await expect(
      revokePersonConsent(deps, professionalActor(fx.doctorId), {
        granteeProfessionalId: fx.doctorId,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('consent narrow + purpose/category matrix', () => {
  it('narrowing revokes out-of-scope grants and keeps survivors', async () => {
    const fx = await resetAndSeed();
    await issuePersonConsent(deps, personActor(fx.personId), {
      granteeProfessionalId: fx.doctorId,
      scope: {
        categories: ['timeline_read', 'assessment_read'],
        purposes: ['treatment', 'care_coordination'],
      },
    });
    expect(await activeGrantCount(fx.personId, fx.doctorId)).toBe(4);

    const narrowed = await narrowPersonConsent(deps, personActor(fx.personId), {
      granteeProfessionalId: fx.doctorId,
      scope: {
        categories: ['timeline_read'],
        purposes: ['treatment'],
      },
    });
    expect(narrowed.grantCount).toBe(1);
    expect(await activeGrantCount(fx.personId, fx.doctorId)).toBe(1);

    // Survivor grant works for treatment + timeline_read only
    const grant = await loadActiveGrant(fx.personId, fx.doctorId, 'timeline_read', 'treatment');
    expect(grant).not.toBeNull();
    const allowed = evaluateHealthAccess(
      pevpRequest(fx.personId, fx.doctorId, { grant, purpose: 'treatment' }),
    );
    expect(allowed.allowed).toBe(true);

    // assessment_read no longer granted
    const denied = evaluateHealthAccess(
      pevpRequest(fx.personId, fx.doctorId, {
        grant,
        category: 'assessment_read',
        purpose: 'treatment',
      }),
    );
    expect(denied.allowed).toBe(false);

    expect(await canReadObservationAs(fx.doctorId, fx.personId, 'care_coordination')).toBe(false);
    expect(await canReadObservationAs(fx.doctorId, fx.personId, 'treatment')).toBe(true);
  });
});

describe('AccessRequest (proposal — no power while pending)', () => {
  it('pending request creates zero grants and does not unlock RLS', async () => {
    const fx = await resetAndSeed();
    const { accessRequestId } = await createPersonAccessRequest(
      deps,
      professionalActor(fx.doctorId),
      {
        personId: fx.personId,
        scope: { categories: ['timeline_read'], purposes: ['treatment'] },
      },
    );
    expect(accessRequestId).toBeTruthy();
    expect(await activeGrantCount(fx.personId, fx.doctorId)).toBe(0);
    expect(await canReadObservationAs(fx.doctorId, fx.personId, 'treatment')).toBe(false);
    expect(audits.some((a) => a.action === 'access_request_created')).toBe(true);
    // PEP: no grant while pending
    const d = evaluateHealthAccess(pevpRequest(fx.personId, fx.doctorId, { grant: null }));
    expect(d).toEqual({ allowed: false, reason: 'no_consent' });
  });

  it('accept materializes consent + grants when none active; still audited', async () => {
    const fx = await resetAndSeed();
    const { accessRequestId } = await createPersonAccessRequest(
      deps,
      professionalActor(fx.doctorId),
      {
        personId: fx.personId,
        scope: { categories: ['timeline_read'], purposes: ['treatment'] },
      },
    );
    const resolved = await resolvePersonAccessRequest(deps, personActor(fx.personId), {
      accessRequestId,
      decision: 'accept',
    });
    expect(resolved.status).toBe('accepted');
    expect(resolved.consentIssued).toBe(true);
    expect(await activeGrantCount(fx.personId, fx.doctorId)).toBe(1);
    expect(await canReadObservationAs(fx.doctorId, fx.personId, 'treatment')).toBe(true);
    expect(audits.some((a) => a.action === 'access_request_accepted')).toBe(true);
  });

  it('reject does not issue consent or grants', async () => {
    const fx = await resetAndSeed();
    const { accessRequestId } = await createPersonAccessRequest(
      deps,
      professionalActor(fx.doctorId),
      {
        personId: fx.personId,
        scope: { categories: ['timeline_read'], purposes: ['treatment'] },
      },
    );
    const resolved = await resolvePersonAccessRequest(deps, personActor(fx.personId), {
      accessRequestId,
      decision: 'reject',
    });
    expect(resolved.status).toBe('rejected');
    expect(resolved.consentIssued).toBe(false);
    expect(await activeGrantCount(fx.personId, fx.doctorId)).toBe(0);
    expect(await canReadObservationAs(fx.doctorId, fx.personId, 'treatment')).toBe(false);
  });

  it('requester can withdraw; double resolve fails', async () => {
    const fx = await resetAndSeed();
    const { accessRequestId } = await createPersonAccessRequest(
      deps,
      professionalActor(fx.doctorId),
      {
        personId: fx.personId,
        scope: { categories: ['timeline_read'], purposes: ['treatment'] },
      },
    );
    const resolved = await resolvePersonAccessRequest(deps, professionalActor(fx.doctorId), {
      accessRequestId,
      decision: 'withdraw',
    });
    expect(resolved.status).toBe('withdrawn');
    await expect(
      resolvePersonAccessRequest(deps, personActor(fx.personId), {
        accessRequestId,
        decision: 'accept',
      }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });
});

describe('RLS write policies for consent/access (0015)', () => {
  it('professional principal cannot insert access_grants directly', async () => {
    const fx = await resetAndSeed();
    await expect(
      runInPrincipalContext(
        appPool,
        {
          principalType: 'professional',
          principalId: fx.doctorId,
          purpose: 'treatment',
        },
        async (client) => {
          await client.query(
            `INSERT INTO access_grants (
               person_id, grantee_professional_id, category, purpose, status, relationship_class
             ) VALUES ($1, $2, 'timeline_read', 'treatment', 'active', 'care_team_member')`,
            [fx.personId, fx.doctorId],
          );
        },
      ),
    ).rejects.toThrow();
  });

  it('person principal cannot update access_grants (RLS filters all rows)', async () => {
    const fx = await resetAndSeed();
    await issuePersonConsent(deps, personActor(fx.personId), {
      granteeProfessionalId: fx.doctorId,
      scope: { categories: ['timeline_read'], purposes: ['treatment'] },
    });
    // UPDATE without a matching policy affects 0 rows (does not throw).
    const result = await runInPrincipalContext(
      appPool,
      { principalType: 'person', principalId: fx.personId, purpose: 'treatment' },
      async (client) => {
        return client.query(`UPDATE access_grants SET status = 'active' WHERE person_id = $1`, [
          fx.personId,
        ]);
      },
    );
    expect(result.rowCount ?? 0).toBe(0);
    // Still active from the service write (superuser view)
    expect(await activeGrantCount(fx.personId, fx.doctorId)).toBe(1);
  });
});
