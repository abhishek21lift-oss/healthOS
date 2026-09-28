/**
 * Phase 4 collaboration integration — real PostgreSQL, Phase 3 sessions,
 * org/care-team/invitation security matrix, concurrency, RLS isolation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  login,
  registerAccount,
  verifyEmail,
  resolveSession,
  type AuthDeps,
  type AuthenticatedPrincipal,
} from '@health-os/auth';
import {
  createPool,
  defaultTestDsn,
  runInPrincipalContext,
  runMigrations,
  withClient,
  type Pool,
} from '@health-os/database';

import {
  activateMembership,
  addCareTeamMember,
  changeMemberRole,
  createCareTeam,
  createOrganization,
  createPersonToProfessionalInvitation,
  createProfessionalToPersonInvitation,
  claimCollaborationInvitation,
  endMembership,
  inviteOrganizationMember,
  listMyOrganizationMemberships,
  listMyRelationships,
  rejectCollaborationInvitation,
  removeCareTeamMember,
  requireCollaborationActor,
  revokeCollaborationInvitation,
  setOrganizationStatus,
  type CollaborationActor,
  type CollaborationDeps,
  type CollaborationSecurityEvent,
} from './index.js';

const superDsn = defaultTestDsn('postgres');
const appDsn = defaultTestDsn('app');

let superPool: Pool;
let appPool: Pool;
let authDeps: AuthDeps;
let deps: CollaborationDeps;
let events: CollaborationSecurityEvent[] = [];

let ipSeq = 0;

function uniqueEmail(prefix: string): string {
  const stamp = String(Date.now());
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${rand}@example.com`;
}

function uniqueMeta(): { ipHint: string } {
  ipSeq += 1;
  const third = String(Math.floor(ipSeq / 250));
  const fourth = String(ipSeq % 250);
  return { ipHint: `10.8.${third}.${fourth}` };
}

function requirePersonId(principal: AuthenticatedPrincipal): string {
  if (principal.personId === null) {
    throw new Error('expected person principal');
  }
  return principal.personId;
}

async function resetTables(): Promise<void> {
  await withClient(superPool, async (c) => {
    // TRUNCATE bypasses per-row immutability triggers; CASCADE clears dependents.
    await c.query(`TRUNCATE TABLE
      collaboration_security_events,
      organization_membership_history,
      person_professional_relationships,
      auth_security_events,
      sessions,
      email_verification_tokens,
      contact_points,
      accounts,
      invitations,
      access_grants,
      access_requests,
      care_team_memberships,
      care_teams,
      organization_memberships,
      organizations,
      consent_revisions,
      consents,
      private_professional_notes,
      observations,
      assessments,
      goals,
      care_plans,
      interventions,
      outcomes,
      handoffs,
      handoff_items,
      tasks,
      audit_logs,
      person_access_logs,
      break_glass_records,
      professionals,
      persons
    CASCADE`);
  });
  events = [];
}

async function registerVerifiedPerson(email: string): Promise<{
  accountId: string;
  principal: AuthenticatedPrincipal;
  actor: CollaborationActor;
  sessionToken: string;
}> {
  const password = 'Correct Horse Battery Staple 9!';
  const reg = await registerAccount(
    authDeps,
    { email, password, birthDate: '1990-05-15' },
    uniqueMeta(),
  );
  await verifyEmail(authDeps, { token: reg.verificationToken }, uniqueMeta());
  const session = await login(authDeps, { email, password }, uniqueMeta());
  const principal = await resolveSession(authDeps, { sessionToken: session.sessionToken });
  if (principal === null) {
    throw new Error('session missing');
  }
  const actor = await requireCollaborationActor(authDeps, session.sessionToken);
  return { accountId: session.accountId, principal, actor, sessionToken: session.sessionToken };
}

async function createProfessionalIdentity(displayName: string): Promise<string> {
  const res = await withClient(superPool, (c) =>
    c.query<{ professional_id: string }>(
      `INSERT INTO professionals (display_name) VALUES ($1) RETURNING professional_id`,
      [displayName],
    ),
  );
  const id = res.rows[0]?.professional_id;
  if (id === undefined) {
    throw new Error('professional insert failed');
  }
  return id;
}

async function attachAccountToProfessional(
  email: string,
  professionalId: string,
): Promise<{ actor: CollaborationActor; sessionToken: string }> {
  const password = 'Correct Horse Battery Staple 9!';
  const reg = await registerAccount(
    authDeps,
    { email, password, birthDate: '1985-01-01' },
    uniqueMeta(),
  );
  await verifyEmail(authDeps, { token: reg.verificationToken }, uniqueMeta());
  await withClient(superPool, (c) =>
    c.query(`UPDATE accounts SET professional_id = $1, person_id = NULL WHERE account_id = $2`, [
      professionalId,
      reg.accountId,
    ]),
  );
  const session = await login(authDeps, { email, password }, uniqueMeta());
  const actor = await requireCollaborationActor(authDeps, session.sessionToken);
  return { actor, sessionToken: session.sessionToken };
}

function asProfessional(actor: CollaborationActor): CollaborationActor {
  if (actor.professionalId === null) {
    throw new Error('expected professional');
  }
  return actor;
}

beforeAll(async () => {
  superPool = createPool({ connectionString: superDsn, max: 4 });
  appPool = createPool({ connectionString: appDsn, max: 4 });
  await runMigrations(superPool);
  authDeps = { pool: appPool };
  deps = {
    pool: appPool,
    onEvent: (e: CollaborationSecurityEvent): void => {
      events.push(e);
    },
  };
}, 180_000);

beforeEach(async () => {
  await resetTables();
  events = [];
});

afterAll(async () => {
  await superPool.end();
  await appPool.end();
});

describe('organization model', () => {
  it('creates organization with owner membership and audit event', async () => {
    const profId = await createProfessionalIdentity('Founder');
    const { actor } = await attachAccountToProfessional(uniqueEmail('founder'), profId);
    const { organizationId } = await createOrganization(deps, asProfessional(actor), {
      name: 'Clinic A',
    });
    expect(organizationId).toBeTruthy();
    expect(events.some((e) => e.eventType === 'organization_created')).toBe(true);

    const memberships = await listMyOrganizationMemberships(deps, asProfessional(actor));
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.role).toBe('owner');
    expect(memberships[0]?.status).toBe('active');
  });

  it('denies non-member organization status change', async () => {
    const founderId = await createProfessionalIdentity('Founder');
    const founder = await attachAccountToProfessional(uniqueEmail('founder'), founderId);
    const { organizationId } = await createOrganization(deps, asProfessional(founder.actor), {
      name: 'Clinic A',
    });

    const outsiderId = await createProfessionalIdentity('Outsider');
    const outsider = await attachAccountToProfessional(uniqueEmail('outsider'), outsiderId);
    await expect(
      setOrganizationStatus(deps, asProfessional(outsider.actor), {
        organizationId,
        status: 'inactive',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('organization membership lifecycle', () => {
  it('invite → activate → role change → end; history retained', async () => {
    const founderId = await createProfessionalIdentity('Founder');
    const founder = await attachAccountToProfessional(uniqueEmail('founder'), founderId);
    const { organizationId } = await createOrganization(deps, asProfessional(founder.actor), {
      name: 'Clinic A',
    });

    const staffId = await createProfessionalIdentity('Staff');
    const staff = await attachAccountToProfessional(uniqueEmail('staff'), staffId);

    const { membershipId } = await inviteOrganizationMember(deps, asProfessional(founder.actor), {
      organizationId,
      professionalId: staffId,
      role: 'staff',
    });
    expect(events.some((e) => e.eventType === 'membership_invited')).toBe(true);

    await activateMembership(deps, asProfessional(staff.actor), { membershipId });
    expect(events.some((e) => e.eventType === 'membership_activated')).toBe(true);

    await changeMemberRole(deps, asProfessional(founder.actor), {
      membershipId,
      role: 'manager',
    });
    expect(events.some((e) => e.eventType === 'role_changed')).toBe(true);

    await endMembership(deps, asProfessional(founder.actor), { membershipId });
    expect(events.some((e) => e.eventType === 'membership_ended')).toBe(true);

    const hist = await withClient(superPool, (c) =>
      c.query<{ event_type: string }>(
        `SELECT event_type FROM organization_membership_history WHERE membership_id = $1
         ORDER BY occurred_at`,
        [membershipId],
      ),
    );
    expect(hist.rows.map((r) => r.event_type)).toEqual([
      'membership_invited',
      'membership_activated',
      'role_changed',
      'membership_ended',
    ]);

    await expect(
      activateMembership(deps, asProfessional(staff.actor), { membershipId }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('staff cannot change roles (admin boundary)', async () => {
    const founderId = await createProfessionalIdentity('Founder');
    const founder = await attachAccountToProfessional(uniqueEmail('founder'), founderId);
    const { organizationId } = await createOrganization(deps, asProfessional(founder.actor), {
      name: 'Clinic A',
    });
    const staffId = await createProfessionalIdentity('Staff');
    const staff = await attachAccountToProfessional(uniqueEmail('staff'), staffId);
    const { membershipId } = await inviteOrganizationMember(deps, asProfessional(founder.actor), {
      organizationId,
      professionalId: staffId,
      role: 'staff',
    });
    await activateMembership(deps, asProfessional(staff.actor), { membershipId });

    await expect(
      changeMemberRole(deps, asProfessional(staff.actor), { membershipId, role: 'admin' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('cross-organization: admin of A cannot manage B', async () => {
    const aId = await createProfessionalIdentity('A owner');
    const a = await attachAccountToProfessional(uniqueEmail('a'), aId);
    await createOrganization(deps, asProfessional(a.actor), { name: 'Org A' });

    const bId = await createProfessionalIdentity('B owner');
    const b = await attachAccountToProfessional(uniqueEmail('b'), bId);
    const orgB = await createOrganization(deps, asProfessional(b.actor), { name: 'Org B' });

    const targetId = await createProfessionalIdentity('Target');
    await expect(
      inviteOrganizationMember(deps, asProfessional(a.actor), {
        organizationId: orgB.organizationId,
        professionalId: targetId,
        role: 'staff',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    const rows = await runInPrincipalContext(
      appPool,
      { principalType: 'professional', principalId: aId, purpose: 'collab:read' },
      async (client) => {
        const res = await client.query(
          `SELECT membership_id FROM organization_memberships WHERE organization_id = $1`,
          [orgB.organizationId],
        );
        return res.rowCount ?? 0;
      },
    );
    expect(rows).toBe(0);
  });
});

describe('care team + relationships', () => {
  it('person creates care team, adds professional, ends membership', async () => {
    const person = await registerVerifiedPerson(uniqueEmail('alice'));
    const personId = requirePersonId(person.principal);
    const { careTeamId } = await createCareTeam(deps, person.actor, { personId });
    expect(careTeamId).toBeTruthy();
    expect(events.some((e) => e.eventType === 'care_team_created')).toBe(true);

    const profId = await createProfessionalIdentity('Dr');
    const { membershipId, relationshipId } = await addCareTeamMember(deps, person.actor, {
      careTeamId,
      professionalId: profId,
    });
    expect(membershipId).toBeTruthy();
    expect(relationshipId).toBeTruthy();

    const rels = await listMyRelationships(deps, person.actor);
    expect(rels.some((r) => r.professionalId === profId && r.status === 'active')).toBe(true);

    await removeCareTeamMember(deps, person.actor, { membershipId });
    expect(events.some((e) => e.eventType === 'care_team_member_removed')).toBe(true);

    const after = await withClient(superPool, (c) =>
      c.query<{ status: string }>(
        `SELECT status FROM person_professional_relationships WHERE relationship_id = $1`,
        [relationshipId],
      ),
    );
    expect(after.rows[0]?.status).toBe('ended');
  });

  it('second open care team for same person conflicts (I-20)', async () => {
    const person = await registerVerifiedPerson(uniqueEmail('alice'));
    const personId = requirePersonId(person.principal);
    await createCareTeam(deps, person.actor, { personId });
    await expect(createCareTeam(deps, person.actor, { personId })).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('professional cannot manage another person care team', async () => {
    const person = await registerVerifiedPerson(uniqueEmail('alice'));
    const personId = requirePersonId(person.principal);
    const { careTeamId } = await createCareTeam(deps, person.actor, { personId });
    const other = await registerVerifiedPerson(uniqueEmail('bob'));
    const profId = await createProfessionalIdentity('Dr');
    await expect(
      addCareTeamMember(deps, other.actor, {
        careTeamId,
        professionalId: profId,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('professional cannot impersonate person via client-supplied personId', async () => {
    const person = await registerVerifiedPerson(uniqueEmail('alice'));
    const outsiderPerson = requirePersonId(person.principal);
    const attacker = await registerVerifiedPerson(uniqueEmail('mallory'));
    await expect(
      createCareTeam(deps, attacker.actor, { personId: outsiderPerson }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('invitation Flow A — professional invites person', () => {
  it('claim creates relationship and care team membership; no health access', async () => {
    const profId = await createProfessionalIdentity('Inviting Dr');
    const prof = await attachAccountToProfessional(uniqueEmail('inviting'), profId);
    const personEmail = uniqueEmail('invitee');
    const { token } = await createProfessionalToPersonInvitation(deps, asProfessional(prof.actor), {
      contactPoint: personEmail,
    });
    expect(token.length).toBeGreaterThan(20);
    expect(events.some((e) => e.eventType === 'invitation_created')).toBe(true);

    const wrong = await registerVerifiedPerson(uniqueEmail('wrong'));
    await expect(claimCollaborationInvitation(deps, wrong.actor, { token })).rejects.toMatchObject({
      code: 'wrong_recipient',
    });

    const person = await registerVerifiedPerson(personEmail);
    const claim = await claimCollaborationInvitation(deps, person.actor, { token });
    expect(claim.flow).toBe('professional_first');
    expect(claim.personId).toBe(person.principal.personId);
    expect(claim.professionalId).toBe(profId);
    expect(claim.relationshipId).toBeTruthy();

    await expect(claimCollaborationInvitation(deps, person.actor, { token })).rejects.toMatchObject(
      { code: 'invalid_token' },
    );

    const claimPersonId = claim.personId;
    if (claimPersonId !== null) {
      const healthRows = await runInPrincipalContext(
        appPool,
        {
          principalType: 'professional',
          principalId: profId,
          purpose: 'treatment',
        },
        async (client) => {
          const res = await client.query(
            `SELECT observation_id FROM observations WHERE person_id = $1`,
            [claimPersonId],
          );
          return res.rowCount ?? 0;
        },
      );
      expect(healthRows).toBe(0);
    }
  });

  it('expired invitation cannot be claimed', async () => {
    const profId = await createProfessionalIdentity('Dr');
    const prof = await attachAccountToProfessional(uniqueEmail('dr'), profId);
    const email = uniqueEmail('late');
    const { token } = await createProfessionalToPersonInvitation(deps, asProfessional(prof.actor), {
      contactPoint: email,
      ttlMs: 1,
    });
    await new Promise((r) => setTimeout(r, 5));
    const person = await registerVerifiedPerson(email);
    await expect(claimCollaborationInvitation(deps, person.actor, { token })).rejects.toMatchObject(
      { code: 'expired_token' },
    );
  });

  it('revoked invitation cannot be claimed', async () => {
    const profId = await createProfessionalIdentity('Dr');
    const prof = await attachAccountToProfessional(uniqueEmail('dr'), profId);
    const email = uniqueEmail('revoked-person');
    const { token, invitationId } = await createProfessionalToPersonInvitation(
      deps,
      asProfessional(prof.actor),
      { contactPoint: email },
    );
    await revokeCollaborationInvitation(deps, asProfessional(prof.actor), { invitationId });
    const person = await registerVerifiedPerson(email);
    await expect(claimCollaborationInvitation(deps, person.actor, { token })).rejects.toMatchObject(
      { code: 'invalid_token' },
    );
  });

  it('unknown token fails closed', async () => {
    const person = await registerVerifiedPerson(uniqueEmail('p'));
    await expect(
      claimCollaborationInvitation(deps, person.actor, { token: 'not-a-real-token-value' }),
    ).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('concurrent claim: only one wins', async () => {
    const profId = await createProfessionalIdentity('Dr');
    const prof = await attachAccountToProfessional(uniqueEmail('dr'), profId);
    const email = uniqueEmail('race');
    const { token } = await createProfessionalToPersonInvitation(deps, asProfessional(prof.actor), {
      contactPoint: email,
    });
    const person = await registerVerifiedPerson(email);

    const results = await Promise.allSettled([
      claimCollaborationInvitation(deps, person.actor, { token }),
      claimCollaborationInvitation(deps, person.actor, { token }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const fail = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(fail).toHaveLength(1);
  });
});

describe('invitation Flow B — person invites professional', () => {
  it('professional claims and relationship starts; wrong professional denied', async () => {
    const person = await registerVerifiedPerson(uniqueEmail('alice'));
    const personId = requirePersonId(person.principal);
    const targetEmail = uniqueEmail('pro-target');
    const { token } = await createPersonToProfessionalInvitation(deps, person.actor, {
      contactPoint: targetEmail,
    });

    const wrongProfId = await createProfessionalIdentity('Wrong');
    const wrong = await attachAccountToProfessional(uniqueEmail('wrong-prof'), wrongProfId);
    await expect(
      claimCollaborationInvitation(deps, asProfessional(wrong.actor), { token }),
    ).rejects.toMatchObject({ code: 'wrong_recipient' });

    const targetProfId = await createProfessionalIdentity('Target Dr');
    const target = await attachAccountToProfessional(targetEmail, targetProfId);
    const claim = await claimCollaborationInvitation(deps, asProfessional(target.actor), {
      token,
    });
    expect(claim.flow).toBe('person_first');
    expect(claim.professionalId).toBe(targetProfId);
    expect(claim.personId).toBe(personId);

    await expect(
      claimCollaborationInvitation(deps, asProfessional(target.actor), { token }),
    ).rejects.toMatchObject({ code: 'invalid_token' });

    await expect(claimCollaborationInvitation(deps, person.actor, { token })).rejects.toMatchObject(
      { code: 'wrong_recipient' },
    );
  });

  it('person revokes invitation; claim then fails', async () => {
    const person = await registerVerifiedPerson(uniqueEmail('alice'));
    const email = uniqueEmail('reject-prof');
    const { token, invitationId } = await createPersonToProfessionalInvitation(deps, person.actor, {
      contactPoint: email,
    });
    await revokeCollaborationInvitation(deps, person.actor, { invitationId });

    const profId = await createProfessionalIdentity('P');
    const prof = await attachAccountToProfessional(email, profId);
    await expect(
      claimCollaborationInvitation(deps, asProfessional(prof.actor), { token }),
    ).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('recipient rejects invitation; claim then fails', async () => {
    const person = await registerVerifiedPerson(uniqueEmail('alice'));
    const email = uniqueEmail('reject-prof2');
    const { token, invitationId } = await createPersonToProfessionalInvitation(deps, person.actor, {
      contactPoint: email,
    });

    const profId = await createProfessionalIdentity('P2');
    const prof = await attachAccountToProfessional(email, profId);
    await rejectCollaborationInvitation(deps, asProfessional(prof.actor), { invitationId });
    await expect(
      claimCollaborationInvitation(deps, asProfessional(prof.actor), { token }),
    ).rejects.toMatchObject({ code: 'invalid_token' });
  });
});

describe('health authorization separation (I-3)', () => {
  it('org admin role alone yields zero health rows', async () => {
    const founderId = await createProfessionalIdentity('Admin founder');
    const founder = await attachAccountToProfessional(uniqueEmail('admin'), founderId);
    await createOrganization(deps, asProfessional(founder.actor), { name: 'Clinic' });

    const personRes = await withClient(superPool, (c) =>
      c.query<{ person_id: string }>(
        `INSERT INTO persons (display_name, is_adult) VALUES ('Patient', true) RETURNING person_id`,
      ),
    );
    const personId = personRes.rows[0]?.person_id ?? '';
    await withClient(superPool, (c) =>
      c.query(
        `INSERT INTO observations (person_id, code, value_numeric, unit, data_class)
         VALUES ($1, 'heart_rate', 70, 'bpm', 'SHARED_HEALTH')`,
        [personId],
      ),
    );

    const rows = await runInPrincipalContext(
      appPool,
      { principalType: 'professional', principalId: founderId, purpose: 'treatment' },
      async (client) => {
        const res = await client.query(`SELECT observation_id FROM observations`);
        return res.rowCount ?? 0;
      },
    );
    expect(rows).toBe(0);

    const notes = await runInPrincipalContext(
      appPool,
      { principalType: 'professional', principalId: founderId, purpose: 'treatment' },
      async (client) => {
        const res = await client.query(`SELECT note_id FROM private_professional_notes`);
        return res.rowCount ?? 0;
      },
    );
    expect(notes).toBe(0);
  });

  it('care team membership alone without AccessGrant still denies health (I-1)', async () => {
    const person = await registerVerifiedPerson(uniqueEmail('alice'));
    const personId = requirePersonId(person.principal);
    const profId = await createProfessionalIdentity('CT only');
    const { careTeamId } = await createCareTeam(deps, person.actor, { personId });
    await addCareTeamMember(deps, person.actor, { careTeamId, professionalId: profId });

    await withClient(superPool, (c) =>
      c.query(
        `INSERT INTO observations (person_id, code, value_numeric, unit, data_class)
         VALUES ($1, 'heart_rate', 60, 'bpm', 'SHARED_HEALTH')`,
        [personId],
      ),
    );

    const rows = await runInPrincipalContext(
      appPool,
      { principalType: 'professional', principalId: profId, purpose: 'treatment' },
      async (client) => {
        const res = await client.query(
          `SELECT observation_id FROM observations WHERE person_id = $1`,
          [personId],
        );
        return res.rowCount ?? 0;
      },
    );
    expect(rows).toBe(0);
  });
});

describe('RLS collaboration isolation', () => {
  it('person without relationship cannot enumerate unrelated professionals (no directory)', async () => {
    await createProfessionalIdentity('Unrelated Dr 1');
    await createProfessionalIdentity('Unrelated Dr 2');
    const person = await registerVerifiedPerson(uniqueEmail('alice'));
    const personId = requirePersonId(person.principal);
    const rows = await runInPrincipalContext(
      appPool,
      { principalType: 'person', principalId: personId, purpose: 'collab:read' },
      async (client) => {
        const res = await client.query(`SELECT professional_id FROM professionals`);
        return res.rowCount ?? 0;
      },
    );
    expect(rows).toBe(0);
  });

  it('unrelated professional cannot read another org memberships', async () => {
    const aId = await createProfessionalIdentity('A');
    const a = await attachAccountToProfessional(uniqueEmail('a'), aId);
    const orgA = await createOrganization(deps, asProfessional(a.actor), { name: 'OA' });
    const bId = await createProfessionalIdentity('B');
    const b = await attachAccountToProfessional(uniqueEmail('b'), bId);
    await createOrganization(deps, asProfessional(b.actor), { name: 'OB' });

    const rows = await runInPrincipalContext(
      appPool,
      { principalType: 'professional', principalId: bId, purpose: 'collab:read' },
      async (client) => {
        const res = await client.query(
          `SELECT membership_id FROM organization_memberships WHERE organization_id = $1`,
          [orgA.organizationId],
        );
        return res.rowCount ?? 0;
      },
    );
    expect(rows).toBe(0);
  });

  it('unrelated professional cannot read pending invitations of others', async () => {
    const profId = await createProfessionalIdentity('Inviter');
    const inviter = await attachAccountToProfessional(uniqueEmail('inv'), profId);
    await createProfessionalToPersonInvitation(deps, asProfessional(inviter.actor), {
      contactPoint: uniqueEmail('target'),
    });
    const otherId = await createProfessionalIdentity('Other');
    const rows = await runInPrincipalContext(
      appPool,
      { principalType: 'professional', principalId: otherId, purpose: 'collab:read' },
      async (client) => {
        const res = await client.query(`SELECT invitation_id FROM invitations`);
        return res.rowCount ?? 0;
      },
    );
    expect(rows).toBe(0);
  });

  it('person cannot read others care teams', async () => {
    const p1 = await registerVerifiedPerson(uniqueEmail('p1'));
    const p1Id = requirePersonId(p1.principal);
    await createCareTeam(deps, p1.actor, { personId: p1Id });
    const p2 = await registerVerifiedPerson(uniqueEmail('p2'));
    const p2Id = requirePersonId(p2.principal);
    const rows = await runInPrincipalContext(
      appPool,
      { principalType: 'person', principalId: p2Id, purpose: 'collab:read' },
      async (client) => {
        const res = await client.query(`SELECT care_team_id FROM care_teams`);
        return res.rowCount ?? 0;
      },
    );
    expect(rows).toBe(0);
  });
});

describe('duplicate person prevention (I-17)', () => {
  it('claim does not fork person for existing verified contact', async () => {
    const profId = await createProfessionalIdentity('Dr');
    const prof = await attachAccountToProfessional(uniqueEmail('dr'), profId);
    const email = uniqueEmail('dup');
    const person = await registerVerifiedPerson(email);
    const personCountBefore = await withClient(superPool, (c) =>
      c.query<{ n: string }>(`SELECT count(*)::text AS n FROM persons`),
    );
    const { token } = await createProfessionalToPersonInvitation(deps, asProfessional(prof.actor), {
      contactPoint: email,
    });
    await claimCollaborationInvitation(deps, person.actor, { token });
    const personCountAfter = await withClient(superPool, (c) =>
      c.query<{ n: string }>(`SELECT count(*)::text AS n FROM persons`),
    );
    expect(personCountAfter.rows[0]?.n).toBe(personCountBefore.rows[0]?.n);
  });
});
