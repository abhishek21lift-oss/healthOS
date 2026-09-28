/**
 * Care team + person↔professional relationship lifecycle (Phase 4).
 * Active care-team membership is a relationship fact — not health access (Phase 5).
 */
import {
  addCareTeamMembership,
  closeCareTeamState,
  endCareTeamMembership,
  endRelationship,
  startRelationship,
} from '@health-os/domain';
import {
  beginRequest,
  clearRequest,
  runInSystemContext,
  withClient,
  type Pool,
} from '@health-os/database';

import {
  CollaborationError,
  insertCollaborationEvent,
  toCollaborationError,
  type CollaborationActor,
  type CollaborationSecurityEvent,
} from './types.js';

export interface CareDeps {
  readonly pool: Pool;
  readonly onEvent?: (event: CollaborationSecurityEvent) => void;
}

export async function createCareTeam(
  deps: CareDeps,
  actor: CollaborationActor,
  input: { readonly personId: string },
): Promise<{ careTeamId: string }> {
  if (actor.personId === null || actor.personId !== input.personId) {
    throw new CollaborationError('forbidden', 'Person may only manage own care team');
  }
  const personId = input.personId;
  try {
    return await runInSystemContext(deps.pool, 'collab:create_care_team', async (client) => {
      const res = await client.query<{ care_team_id: string }>(
        `INSERT INTO care_teams (person_id, status) VALUES ($1, 'open') RETURNING care_team_id`,
        [personId],
      );
      const careTeamId = res.rows[0]?.care_team_id ?? '';
      await insertCollaborationEvent(client, {
        eventType: 'care_team_created',
        personId,
        actorPrincipalType: 'person',
        actorPrincipalId: personId,
        metadata: { careTeamId },
      });
      deps.onEvent?.({
        eventType: 'care_team_created',
        personId,
        actorPrincipalType: 'person',
        actorPrincipalId: personId,
        metadata: { careTeamId },
      });
      return { careTeamId };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('uq_care_teams_one_open_per_person')) {
      throw new CollaborationError('conflict', 'Care team already open', { cause: error });
    }
    throw toCollaborationError(error);
  }
}

export async function closeCareTeam(
  deps: CareDeps,
  actor: CollaborationActor,
  input: { readonly careTeamId: string },
): Promise<void> {
  if (actor.personId === null) {
    throw new CollaborationError('forbidden', 'Person principal required');
  }
  await runInSystemContext(deps.pool, 'collab:close_care_team', async (client) => {
    const team = await client.query<{ person_id: string; status: 'open' | 'closed' }>(
      `SELECT person_id, status FROM care_teams WHERE care_team_id = $1 FOR UPDATE`,
      [input.careTeamId],
    );
    const row = team.rows[0];
    if (row === undefined) {
      throw new CollaborationError('not_found', 'Care team not found');
    }
    if (row.person_id !== actor.personId) {
      throw new CollaborationError('forbidden', 'Person may only manage own care team');
    }
    const next = closeCareTeamState(row.status, Date.now());
    await client.query(
      `UPDATE care_teams SET status = $1, closed_at = now() WHERE care_team_id = $2`,
      [next.status, input.careTeamId],
    );
    // End active memberships when team closes.
    await client.query(
      `UPDATE care_team_memberships
       SET status = 'ended', ended_at = now()
       WHERE care_team_id = $1 AND status = 'active'`,
      [input.careTeamId],
    );
    await client.query(
      `UPDATE person_professional_relationships
       SET status = 'ended', ended_at = now()
       WHERE care_team_id = $1 AND status = 'active'`,
      [input.careTeamId],
    );
    // Phase 5 I-9: revoke grants for memberships on the closed team.
    await client.query(
      `UPDATE access_grants ag
       SET status = 'revoked', effective_until = now(), revoked_at = now()
       FROM care_team_memberships ctm
       WHERE ag.membership_id = ctm.membership_id
         AND ctm.care_team_id = $1
         AND ag.status = 'active'`,
      [input.careTeamId],
    );
    await insertCollaborationEvent(client, {
      eventType: 'care_team_closed',
      personId: actor.personId,
      actorPrincipalType: 'person',
      actorPrincipalId: actor.personId,
      metadata: { careTeamId: input.careTeamId },
    });
    deps.onEvent?.({
      eventType: 'care_team_closed',
      personId: actor.personId,
      actorPrincipalType: 'person',
      actorPrincipalId: actor.personId,
      metadata: { careTeamId: input.careTeamId },
    });
  });
}

export async function addCareTeamMember(
  deps: CareDeps,
  actor: CollaborationActor,
  input: {
    readonly careTeamId: string;
    readonly professionalId: string;
    readonly organizationId?: string | null;
    readonly collaborationContext?: string;
  },
): Promise<{ membershipId: string; relationshipId: string }> {
  if (actor.personId === null) {
    throw new CollaborationError('forbidden', 'Person principal required');
  }
  const personId = actor.personId;
  return runInSystemContext(deps.pool, 'collab:add_care_member', async (client) => {
    const team = await client.query<{ person_id: string; status: string }>(
      `SELECT person_id, status FROM care_teams WHERE care_team_id = $1 FOR UPDATE`,
      [input.careTeamId],
    );
    const row = team.rows[0];
    if (row?.status !== 'open') {
      throw new CollaborationError('not_found', 'Open care team not found');
    }
    if (row.person_id !== personId) {
      throw new CollaborationError('forbidden', 'Person may only manage own care team');
    }

    const existing = await client.query<{ membership_id: string }>(
      `SELECT membership_id FROM care_team_memberships
       WHERE care_team_id = $1 AND professional_id = $2 AND status = 'active'`,
      [input.careTeamId, input.professionalId],
    );
    if ((existing.rowCount ?? 0) > 0) {
      throw new CollaborationError('conflict', 'Professional already on care team');
    }

    const membershipId = crypto.randomUUID();
    const domainMember = addCareTeamMembership({
      membershipId: membershipId as never,
      careTeamId: input.careTeamId as never,
      personId: personId as never,
      professionalId: input.professionalId as never,
      joinedAt: Date.now(),
    });
    await client.query(
      `INSERT INTO care_team_memberships
         (membership_id, care_team_id, person_id, professional_id, status, joined_at)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))`,
      [
        domainMember.membershipId,
        input.careTeamId,
        personId,
        input.professionalId,
        domainMember.status,
        domainMember.joinedAt,
      ],
    );

    // Upsert relationship (I-17 / no duplicate active relationship).
    const relExisting = await client.query<{ relationship_id: string; status: string }>(
      `SELECT relationship_id, status FROM person_professional_relationships
       WHERE person_id = $1 AND professional_id = $2
         AND status = 'active'
       FOR UPDATE`,
      [personId, input.professionalId],
    );
    let relationshipId: string;
    if ((relExisting.rowCount ?? 0) > 0) {
      relationshipId = relExisting.rows[0]?.relationship_id ?? '';
      await client.query(
        `UPDATE person_professional_relationships
         SET care_team_id = $2, organization_id = COALESCE($3, organization_id)
         WHERE relationship_id = $1`,
        [relationshipId, input.careTeamId, input.organizationId ?? null],
      );
    } else {
      // End any ended-row collision is fine; insert new active.
      const rel = await client.query<{ relationship_id: string }>(
        `INSERT INTO person_professional_relationships
           (person_id, professional_id, care_team_id, organization_id, collaboration_context, status, started_at)
         VALUES ($1, $2, $3, $4, $5, 'active', now())
         ON CONFLICT DO NOTHING
         RETURNING relationship_id`,
        [
          personId,
          input.professionalId,
          input.careTeamId,
          input.organizationId ?? null,
          input.collaborationContext ?? 'care_coordination',
        ],
      );
      if ((rel.rowCount ?? 0) === 0) {
        const pick = await client.query<{ relationship_id: string }>(
          `SELECT relationship_id FROM person_professional_relationships
           WHERE person_id = $1 AND professional_id = $2 AND status = 'active'`,
          [personId, input.professionalId],
        );
        relationshipId = pick.rows[0]?.relationship_id ?? '';
      } else {
        relationshipId = rel.rows[0]?.relationship_id ?? '';
      }
    }

    await insertCollaborationEvent(client, {
      eventType: 'care_team_member_added',
      personId,
      professionalId: input.professionalId,
      actorPrincipalType: 'person',
      actorPrincipalId: personId,
      metadata: { membershipId: domainMember.membershipId, relationshipId },
    });
    deps.onEvent?.({
      eventType: 'care_team_member_added',
      personId,
      professionalId: input.professionalId,
      actorPrincipalType: 'person',
      actorPrincipalId: personId,
      metadata: { membershipId: domainMember.membershipId, relationshipId },
    });

    return { membershipId: domainMember.membershipId, relationshipId };
  });
}

export async function removeCareTeamMember(
  deps: CareDeps,
  actor: CollaborationActor,
  input: { readonly membershipId: string },
): Promise<void> {
  await runInSystemContext(deps.pool, 'collab:remove_care_member', async (client) => {
    const mem = await client.query<{
      membership_id: string;
      care_team_id: string;
      person_id: string;
      professional_id: string;
      status: 'active' | 'ended';
      joined_at: Date;
      ended_at: Date | null;
    }>(
      `SELECT membership_id, care_team_id, person_id, professional_id, status, joined_at, ended_at
       FROM care_team_memberships WHERE membership_id = $1 FOR UPDATE`,
      [input.membershipId],
    );
    const row = mem.rows[0];
    if (row === undefined) {
      throw new CollaborationError('not_found', 'Membership not found');
    }
    const isPerson = actor.personId !== null && actor.personId === row.person_id;
    const isSelfProfessional =
      actor.professionalId !== null && actor.professionalId === row.professional_id;
    if (!isPerson && !isSelfProfessional) {
      throw new CollaborationError('forbidden', 'Not permitted');
    }

    const domain = endCareTeamMembership(
      {
        membershipId: row.membership_id as never,
        careTeamId: row.care_team_id as never,
        personId: row.person_id as never,
        professionalId: row.professional_id as never,
        status: row.status,
        joinedAt: row.joined_at.getTime(),
        endedAt: row.ended_at?.getTime() ?? null,
      },
      Date.now(),
    );
    if (domain.status !== 'ended') {
      throw new CollaborationError('invalid_state', 'Membership end failed');
    }
    await client.query(
      `UPDATE care_team_memberships SET status = 'ended', ended_at = now() WHERE membership_id = $1`,
      [row.membership_id],
    );
    // End related relationship if no other active membership for pair.
    const other = await client.query(
      `SELECT 1 FROM care_team_memberships
       WHERE person_id = $1 AND professional_id = $2 AND status = 'active'
         AND membership_id <> $3
       LIMIT 1`,
      [row.person_id, row.professional_id, row.membership_id],
    );
    if ((other.rowCount ?? 0) === 0) {
      await client.query(
        `UPDATE person_professional_relationships
         SET status = 'ended', ended_at = now()
         WHERE person_id = $1 AND professional_id = $2 AND status = 'active'`,
        [row.person_id, row.professional_id],
      );
    }
    // Phase 5 I-9: membership end invalidates compiled grants immediately.
    await client.query(
      `UPDATE access_grants
       SET status = 'revoked', effective_until = now(), revoked_at = now()
       WHERE membership_id = $1 AND status = 'active'`,
      [row.membership_id],
    );
    const ev: CollaborationSecurityEvent = {
      eventType: 'care_team_member_removed',
      personId: row.person_id,
      professionalId: row.professional_id,
      actorPrincipalType: actor.personId !== null ? 'person' : 'professional',
      actorPrincipalId: actor.personId ?? actor.professionalId,
      metadata: { membershipId: row.membership_id },
    };
    await insertCollaborationEvent(client, ev);
    deps.onEvent?.(ev);
  });
}

export async function endRelationshipForActor(
  deps: CareDeps,
  actor: CollaborationActor,
  input: { readonly relationshipId: string },
): Promise<void> {
  await runInSystemContext(deps.pool, 'collab:end_relationship', async (client) => {
    const rel = await client.query<{
      relationship_id: string;
      person_id: string;
      professional_id: string;
      status: 'active' | 'ended';
      started_at: Date;
      ended_at: Date | null;
      care_team_id: string | null;
      organization_id: string | null;
      collaboration_context: string;
      created_by_invitation_id: string | null;
    }>(
      `SELECT relationship_id, person_id, professional_id, status, started_at, ended_at,
              care_team_id, organization_id, collaboration_context, created_by_invitation_id
       FROM person_professional_relationships WHERE relationship_id = $1 FOR UPDATE`,
      [input.relationshipId],
    );
    const row = rel.rows[0];
    if (row === undefined) {
      throw new CollaborationError('not_found', 'Relationship not found');
    }
    const isPerson = actor.personId !== null && actor.personId === row.person_id;
    const isProf = actor.professionalId !== null && actor.professionalId === row.professional_id;
    if (!isPerson && !isProf) {
      throw new CollaborationError('forbidden', 'Not permitted');
    }
    endRelationship(
      {
        relationshipId: row.relationship_id as never,
        personId: row.person_id as never,
        professionalId: row.professional_id as never,
        careTeamId: row.care_team_id as never,
        organizationId: row.organization_id as never,
        collaborationContext: row.collaboration_context,
        status: row.status,
        startedAt: row.started_at.getTime(),
        endedAt: row.ended_at?.getTime() ?? null,
        createdByInvitationId: row.created_by_invitation_id,
      },
      Date.now(),
    );
    await client.query(
      `UPDATE person_professional_relationships
       SET status = 'ended', ended_at = now()
       WHERE relationship_id = $1`,
      [row.relationship_id],
    );
    await client.query(
      `UPDATE care_team_memberships
       SET status = 'ended', ended_at = now()
       WHERE person_id = $1 AND professional_id = $2 AND status = 'active'`,
      [row.person_id, row.professional_id],
    );
    // Phase 5 I-9: revoke grants bound to ended memberships for this pair.
    await client.query(
      `UPDATE access_grants ag
       SET status = 'revoked', effective_until = now(), revoked_at = now()
       FROM care_team_memberships ctm
       WHERE ag.membership_id = ctm.membership_id
         AND ctm.person_id = $1 AND ctm.professional_id = $2
         AND ag.status = 'active'`,
      [row.person_id, row.professional_id],
    );
    const ev: CollaborationSecurityEvent = {
      eventType: 'relationship_ended',
      personId: row.person_id,
      professionalId: row.professional_id,
      actorPrincipalType: isPerson ? 'person' : 'professional',
      actorPrincipalId: actor.personId ?? actor.professionalId,
      metadata: { relationshipId: row.relationship_id },
    };
    await insertCollaborationEvent(client, ev);
    deps.onEvent?.(ev);
  });
}

export async function listMyRelationships(
  deps: CareDeps,
  actor: CollaborationActor,
): Promise<
  {
    relationshipId: string;
    personId: string;
    professionalId: string;
    status: string;
    collaborationContext: string;
    startedAt: Date;
    endedAt: Date | null;
  }[]
> {
  if (actor.personId === null && actor.professionalId === null) {
    return [];
  }
  return withClient(deps.pool, async (client) => {
    await client.query('BEGIN');
    try {
      if (actor.personId !== null) {
        await beginRequest(client, {
          principalType: 'person',
          principalId: actor.personId,
          purpose: 'collab:read_relationships',
        });
      } else if (actor.professionalId !== null) {
        await beginRequest(client, {
          principalType: 'professional',
          principalId: actor.professionalId,
          purpose: 'collab:read_relationships',
        });
      }
      const res = await client.query<{
        relationship_id: string;
        person_id: string;
        professional_id: string;
        status: string;
        collaboration_context: string;
        started_at: Date;
        ended_at: Date | null;
      }>(
        `SELECT relationship_id, person_id, professional_id, status,
                collaboration_context, started_at, ended_at
         FROM person_professional_relationships
         WHERE ($1::uuid IS NOT NULL AND person_id = $1)
            OR ($2::uuid IS NOT NULL AND professional_id = $2)
         ORDER BY started_at DESC`,
        [actor.personId, actor.professionalId],
      );
      await client.query('COMMIT');
      return res.rows.map((r) => ({
        relationshipId: r.relationship_id,
        personId: r.person_id,
        professionalId: r.professional_id,
        status: r.status,
        collaborationContext: r.collaboration_context,
        startedAt: r.started_at,
        endedAt: r.ended_at,
      }));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await clearRequest(client);
    }
  });
}

export { startRelationship };
