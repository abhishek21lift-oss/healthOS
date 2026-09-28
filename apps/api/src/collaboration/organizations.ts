/**
 * Organization + organization membership lifecycle (Phase 4).
 * Org role never authorizes health reads (I-3) — collaboration ops only.
 */
import {
  activateOrganizationMembership,
  changeOrganizationRole,
  createCollaborationOrganization,
  deactivateOrganization,
  endOrganizationMembershipState,
  inviteOrganizationMembership,
  isOrganizationAdminRole,
  reactivateOrganization,
  type OrganizationRole,
} from '@health-os/domain';
import {
  runInSystemContext,
  beginRequest,
  clearRequest,
  withClient,
  type Pool,
} from '@health-os/database';

import {
  CollaborationError,
  insertCollaborationEvent,
  loadActiveOrgMembership,
  requireOrgAdmin,
  toCollaborationError,
  type CollaborationActor,
  type CollaborationSecurityEvent,
} from './types.js';

export interface OrgDeps {
  readonly pool: Pool;
  readonly onEvent?: (event: CollaborationSecurityEvent) => void;
}

async function emitSystem(
  deps: OrgDeps,
  client: Parameters<typeof insertCollaborationEvent>[0],
  event: CollaborationSecurityEvent,
): Promise<void> {
  await insertCollaborationEvent(client, event);
  deps.onEvent?.(event);
}

export async function createOrganization(
  deps: OrgDeps,
  actor: CollaborationActor,
  input: { readonly name: string },
): Promise<{ organizationId: string }> {
  if (actor.professionalId === null) {
    throw new CollaborationError('forbidden', 'Professional principal required');
  }
  const professionalId = actor.professionalId;
  const organizationId = await runInSystemContext(
    deps.pool,
    'collab:create_org',
    async (client) => {
      const row = await client.query<{ organization_id: string }>(
        `INSERT INTO organizations (name, status, created_by_professional_id)
       VALUES ($1, 'active', $2)
       RETURNING organization_id`,
        [input.name.trim(), professionalId],
      );
      const id = row.rows[0]?.organization_id ?? '';
      const domainOrg = createCollaborationOrganization({
        organizationId: id as never,
        name: input.name,
        createdByProfessionalId: professionalId as never,
      });
      // Founder becomes owner membership (active) — organizational only.
      const mem = await client.query<{ membership_id: string }>(
        `INSERT INTO organization_memberships
         (organization_id, professional_id, status, role, joined_at, updated_at)
       VALUES ($1, $2, 'active', 'owner', now(), now())
       RETURNING membership_id`,
        [id, professionalId],
      );
      const membershipId = mem.rows[0]?.membership_id ?? '';
      await client.query(
        `INSERT INTO organization_membership_history
         (membership_id, organization_id, professional_id, event_type, new_role, new_status,
          actor_principal_type, actor_principal_id)
       VALUES ($1, $2, $3, 'membership_activated', 'owner', 'active', 'professional', $4)`,
        [membershipId, id, professionalId, professionalId],
      );
      await emitSystem(deps, client, {
        eventType: 'organization_created',
        organizationId: id,
        professionalId,
        actorPrincipalType: 'professional',
        actorPrincipalId: professionalId,
        metadata: { nameLength: domainOrg.name.length },
      });
      return id;
    },
  );
  return { organizationId };
}

export async function setOrganizationStatus(
  deps: OrgDeps,
  actor: CollaborationActor,
  input: { readonly organizationId: string; readonly status: 'active' | 'inactive' },
): Promise<void> {
  if (actor.professionalId === null) {
    throw new CollaborationError('forbidden', 'Professional principal required');
  }
  const actorProfessionalId = actor.professionalId;
  try {
    await runInSystemContext(deps.pool, 'collab:org_status', async (client) => {
      const membership = await loadActiveOrgMembership(
        client,
        input.organizationId,
        actorProfessionalId,
      );
      requireOrgAdmin(membership);
      const current = await client.query<{ status: 'active' | 'inactive' }>(
        `SELECT status FROM organizations WHERE organization_id = $1 FOR UPDATE`,
        [input.organizationId],
      );
      const row = current.rows[0];
      if (row === undefined) {
        throw new CollaborationError('not_found', 'Organization not found');
      }
      const domain = createCollaborationOrganization({
        organizationId: input.organizationId as never,
        name: 'x',
        createdByProfessionalId: null,
      });
      const next =
        input.status === 'inactive'
          ? deactivateOrganization({ ...domain, status: row.status })
          : reactivateOrganization({ ...domain, status: row.status });
      await client.query(
        `UPDATE organizations SET status = $1, updated_at = now() WHERE organization_id = $2`,
        [next.status, input.organizationId],
      );
      await emitSystem(deps, client, {
        eventType: 'organization_status_changed',
        organizationId: input.organizationId,
        professionalId: actorProfessionalId,
        actorPrincipalType: 'professional',
        actorPrincipalId: actorProfessionalId,
        metadata: { status: next.status },
      });
    });
  } catch (error) {
    throw toCollaborationError(error);
  }
}

export async function inviteOrganizationMember(
  deps: OrgDeps,
  actor: CollaborationActor,
  input: {
    readonly organizationId: string;
    readonly professionalId: string;
    readonly role: OrganizationRole;
  },
): Promise<{ membershipId: string }> {
  if (actor.professionalId === null) {
    throw new CollaborationError('forbidden', 'Professional principal required');
  }
  const actorProfessionalId = actor.professionalId;
  if (actorProfessionalId === input.professionalId) {
    // Self-invite not used; founder already owner.
    throw new CollaborationError('validation', 'Invalid invitee');
  }
  return runInSystemContext(deps.pool, 'collab:invite_member', async (client) => {
    const admin = await loadActiveOrgMembership(client, input.organizationId, actorProfessionalId);
    requireOrgAdmin(admin);
    const org = await client.query<{ organization_id: string; status: string }>(
      `SELECT organization_id, status FROM organizations WHERE organization_id = $1 FOR UPDATE`,
      [input.organizationId],
    );
    if (org.rows[0]?.status !== 'active') {
      throw new CollaborationError('not_found', 'Organization not found');
    }

    const existing = await client.query<{ membership_id: string; status: string }>(
      `SELECT membership_id, status FROM organization_memberships
       WHERE organization_id = $1 AND professional_id = $2
         AND status IN ('invited', 'active')
       FOR UPDATE`,
      [input.organizationId, input.professionalId],
    );
    if ((existing.rowCount ?? 0) > 0) {
      throw new CollaborationError('conflict', 'Membership already exists');
    }

    const domain = inviteOrganizationMembership({
      membershipId: 'tmp' as never,
      organizationId: input.organizationId as never,
      professionalId: input.professionalId as never,
      role: input.role,
      invitedAt: Date.now(),
    });

    const inserted = await client.query<{ membership_id: string }>(
      `INSERT INTO organization_memberships
         (organization_id, professional_id, status, role, invited_at, updated_at)
       VALUES ($1, $2, $3, $4, now(), now())
       RETURNING membership_id`,
      [input.organizationId, input.professionalId, domain.status, domain.role],
    );
    const membershipId = inserted.rows[0]?.membership_id ?? '';
    await client.query(
      `INSERT INTO organization_membership_history
         (membership_id, organization_id, professional_id, event_type, new_role, new_status,
          actor_principal_type, actor_principal_id)
       VALUES ($1, $2, $3, 'membership_invited', $4, 'invited', 'professional', $5)`,
      [membershipId, input.organizationId, input.professionalId, input.role, actorProfessionalId],
    );
    await emitSystem(deps, client, {
      eventType: 'membership_invited',
      organizationId: input.organizationId,
      professionalId: input.professionalId,
      actorPrincipalType: 'professional',
      actorPrincipalId: actorProfessionalId,
      metadata: { role: input.role, membershipId },
    });
    return { membershipId };
  });
}

export async function activateMembership(
  deps: OrgDeps,
  actor: CollaborationActor,
  input: { readonly membershipId: string },
): Promise<void> {
  if (actor.professionalId === null) {
    throw new CollaborationError('forbidden', 'Professional principal required');
  }
  const actorProfessionalId = actor.professionalId;
  try {
    await runInSystemContext(deps.pool, 'collab:activate_member', async (client) => {
      const mem = await client.query<{
        membership_id: string;
        organization_id: string;
        professional_id: string;
        status: 'invited' | 'active' | 'ended';
        role: OrganizationRole;
        invited_at: Date | null;
        ended_at: Date | null;
      }>(
        `SELECT membership_id, organization_id, professional_id, status, role, invited_at, ended_at
         FROM organization_memberships WHERE membership_id = $1 FOR UPDATE`,
        [input.membershipId],
      );
      const row = mem.rows[0];
      if (row === undefined) {
        throw new CollaborationError('not_found', 'Membership not found');
      }

      const self = actorProfessionalId === row.professional_id;
      if (!self) {
        const admin = await loadActiveOrgMembership(
          client,
          row.organization_id,
          actorProfessionalId,
        );
        requireOrgAdmin(admin);
      }

      const domain = activateOrganizationMembership({
        membershipId: row.membership_id as never,
        organizationId: row.organization_id as never,
        professionalId: row.professional_id as never,
        role: row.role,
        status: row.status,
        invitedAt: row.invited_at?.getTime() ?? null,
        endedAt: row.ended_at?.getTime() ?? null,
      });
      await client.query(
        `UPDATE organization_memberships SET status = $1, updated_at = now() WHERE membership_id = $2`,
        [domain.status, row.membership_id],
      );
      await client.query(
        `INSERT INTO organization_membership_history
           (membership_id, organization_id, professional_id, event_type, previous_status, new_status,
            actor_principal_type, actor_principal_id)
         VALUES ($1, $2, $3, 'membership_activated', $4, 'active', 'professional', $5)`,
        [
          row.membership_id,
          row.organization_id,
          row.professional_id,
          row.status,
          actorProfessionalId,
        ],
      );
      await emitSystem(deps, client, {
        eventType: 'membership_activated',
        organizationId: row.organization_id,
        professionalId: row.professional_id,
        actorPrincipalType: 'professional',
        actorPrincipalId: actorProfessionalId,
        metadata: { membershipId: row.membership_id },
      });
    });
  } catch (error) {
    throw toCollaborationError(error);
  }
}

export async function endMembership(
  deps: OrgDeps,
  actor: CollaborationActor,
  input: { readonly membershipId: string },
): Promise<void> {
  if (actor.professionalId === null) {
    throw new CollaborationError('forbidden', 'Professional principal required');
  }
  const actorProfessionalId = actor.professionalId;
  try {
    await runInSystemContext(deps.pool, 'collab:end_member', async (client) => {
      const mem = await client.query<{
        membership_id: string;
        organization_id: string;
        professional_id: string;
        status: 'invited' | 'active' | 'ended';
        role: OrganizationRole;
        invited_at: Date | null;
        ended_at: Date | null;
      }>(
        `SELECT membership_id, organization_id, professional_id, status, role, invited_at, ended_at
         FROM organization_memberships WHERE membership_id = $1 FOR UPDATE`,
        [input.membershipId],
      );
      const row = mem.rows[0];
      if (row === undefined) {
        throw new CollaborationError('not_found', 'Membership not found');
      }
      const self = actorProfessionalId === row.professional_id;
      if (!self) {
        const admin = await loadActiveOrgMembership(
          client,
          row.organization_id,
          actorProfessionalId,
        );
        requireOrgAdmin(admin);
      }
      const domain = endOrganizationMembershipState(
        {
          membershipId: row.membership_id as never,
          organizationId: row.organization_id as never,
          professionalId: row.professional_id as never,
          role: row.role,
          status: row.status,
          invitedAt: row.invited_at?.getTime() ?? null,
          endedAt: row.ended_at?.getTime() ?? null,
        },
        Date.now(),
      );
      if (domain.status !== 'ended') {
        throw new CollaborationError('invalid_state', 'Membership end failed');
      }
      await client.query(
        `UPDATE organization_memberships
         SET status = 'ended', ended_at = now(), updated_at = now()
         WHERE membership_id = $1`,
        [row.membership_id],
      );
      await client.query(
        `INSERT INTO organization_membership_history
           (membership_id, organization_id, professional_id, event_type, previous_status, new_status,
            actor_principal_type, actor_principal_id)
         VALUES ($1, $2, $3, 'membership_ended', $4, 'ended', 'professional', $5)`,
        [
          row.membership_id,
          row.organization_id,
          row.professional_id,
          row.status,
          actorProfessionalId,
        ],
      );
      await emitSystem(deps, client, {
        eventType: 'membership_ended',
        organizationId: row.organization_id,
        professionalId: row.professional_id,
        actorPrincipalType: 'professional',
        actorPrincipalId: actorProfessionalId,
        metadata: { membershipId: row.membership_id },
      });
    });
  } catch (error) {
    throw toCollaborationError(error);
  }
}

export async function changeMemberRole(
  deps: OrgDeps,
  actor: CollaborationActor,
  input: { readonly membershipId: string; readonly role: OrganizationRole },
): Promise<void> {
  if (actor.professionalId === null) {
    throw new CollaborationError('forbidden', 'Professional principal required');
  }
  const actorProfessionalId = actor.professionalId;
  try {
    await runInSystemContext(deps.pool, 'collab:role_change', async (client) => {
      const mem = await client.query<{
        membership_id: string;
        organization_id: string;
        professional_id: string;
        status: 'invited' | 'active' | 'ended';
        role: OrganizationRole;
        invited_at: Date | null;
        ended_at: Date | null;
      }>(
        `SELECT membership_id, organization_id, professional_id, status, role, invited_at, ended_at
         FROM organization_memberships WHERE membership_id = $1 FOR UPDATE`,
        [input.membershipId],
      );
      const row = mem.rows[0];
      if (row === undefined) {
        throw new CollaborationError('not_found', 'Membership not found');
      }
      const admin = await loadActiveOrgMembership(client, row.organization_id, actorProfessionalId);
      requireOrgAdmin(admin);
      if (input.role === 'owner' && admin?.role !== 'owner') {
        throw new CollaborationError('forbidden', 'Not permitted');
      }
      const domain = changeOrganizationRole(
        {
          membershipId: row.membership_id as never,
          organizationId: row.organization_id as never,
          professionalId: row.professional_id as never,
          role: row.role,
          status: row.status,
          invitedAt: row.invited_at?.getTime() ?? null,
          endedAt: row.ended_at?.getTime() ?? null,
        },
        input.role,
      );
      if (domain.role === row.role) {
        return;
      }
      await client.query(
        `UPDATE organization_memberships SET role = $1, updated_at = now() WHERE membership_id = $2`,
        [domain.role, row.membership_id],
      );
      await client.query(
        `INSERT INTO organization_membership_history
           (membership_id, organization_id, professional_id, event_type, previous_role, new_role,
            actor_principal_type, actor_principal_id)
         VALUES ($1, $2, $3, 'role_changed', $4, $5, 'professional', $6)`,
        [
          row.membership_id,
          row.organization_id,
          row.professional_id,
          row.role,
          domain.role,
          actorProfessionalId,
        ],
      );
      await emitSystem(deps, client, {
        eventType: 'role_changed',
        organizationId: row.organization_id,
        professionalId: row.professional_id,
        actorPrincipalType: 'professional',
        actorPrincipalId: actorProfessionalId,
        metadata: { from: row.role, to: domain.role },
      });
    });
  } catch (error) {
    throw toCollaborationError(error);
  }
}

export async function listMyOrganizationMemberships(
  deps: OrgDeps,
  actor: CollaborationActor,
): Promise<
  {
    membershipId: string;
    organizationId: string;
    role: string;
    status: string;
    organizationName: string;
    organizationStatus: string;
  }[]
> {
  if (actor.professionalId === null) {
    return [];
  }
  const actorProfessionalId = actor.professionalId;
  return withClient(deps.pool, async (client) => {
    await client.query('BEGIN');
    try {
      await beginRequest(client, {
        principalType: 'professional',
        principalId: actorProfessionalId,
        purpose: 'collab:read_memberships',
      });
      const res = await client.query<{
        membership_id: string;
        organization_id: string;
        role: string;
        status: string;
        organization_name: string;
        organization_status: string;
      }>(
        `SELECT m.membership_id, m.organization_id, m.role, m.status,
                o.name AS organization_name, o.status AS organization_status
         FROM organization_memberships m
         JOIN organizations o ON o.organization_id = m.organization_id
         WHERE m.professional_id = $1
         ORDER BY m.updated_at DESC`,
        [actorProfessionalId],
      );
      await client.query('COMMIT');
      return res.rows.map((r) => ({
        membershipId: r.membership_id,
        organizationId: r.organization_id,
        role: r.role,
        status: r.status,
        organizationName: r.organization_name,
        organizationStatus: r.organization_status,
      }));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await clearRequest(client);
    }
  });
}

export { isOrganizationAdminRole };
