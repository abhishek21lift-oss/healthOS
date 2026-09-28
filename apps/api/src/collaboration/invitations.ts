/**
 * Invitation workflows Phase 4 — Flow A (professional → person) and Flow B (person → professional).
 * Reuses Phase 3 token hashing (SHA-256, single-use, TTL, recipient binding).
 * Claim is transactional with SELECT … FOR UPDATE; never grants health access.
 */
import {
  acceptInvitation as domainAcceptInvitation,
  isInvitationExpired,
  issueInvitation,
  rejectInvitation,
  revokeInvitation,
  type Invitation,
} from '@health-os/domain';
import { runInSystemContext, type Pool, type PoolClient } from '@health-os/database';
import { generateToken, hashToken, normalizeEmail } from '@health-os/auth';

import {
  CollaborationError,
  insertCollaborationEvent,
  toCollaborationError,
  type CollaborationActor,
  type CollaborationSecurityEvent,
} from './types.js';

export interface InvitationDeps {
  readonly pool: Pool;
  readonly onEvent?: (event: CollaborationSecurityEvent) => void;
}

export type InvitationFlowDirection = 'professional_to_person' | 'person_to_professional';

/** Map external direction → DB flow (ADR-0004). */
function dbFlow(direction: InvitationFlowDirection): 'professional_first' | 'person_first' {
  return direction === 'professional_to_person' ? 'professional_first' : 'person_first';
}

function contactHint(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) {
    return '***';
  }
  return `${email.slice(0, 2)}***${email.slice(at)}`;
}

async function loadInvitationForUpdate(
  client: PoolClient,
  tokenHash: Buffer,
): Promise<{
  invitation_id: string;
  flow: string;
  status: string;
  contact_point: string;
  recipient_normalized: string | null;
  expires_at: Date;
  consumed_at: Date | null;
  invited_by_professional_id: string | null;
  invited_by_person_id: string | null;
  organization_id: string | null;
  claimed_person_id: string | null;
  claimed_professional_id: string | null;
  invite_kind: string;
  requested_org_role: string | null;
}> {
  const found = await client.query<{
    invitation_id: string;
    flow: string;
    status: string;
    contact_point: string;
    recipient_normalized: string | null;
    expires_at: Date;
    consumed_at: Date | null;
    invited_by_professional_id: string | null;
    invited_by_person_id: string | null;
    organization_id: string | null;
    claimed_person_id: string | null;
    claimed_professional_id: string | null;
    invite_kind: string;
    requested_org_role: string | null;
  }>(
    `SELECT invitation_id, flow, status, contact_point, recipient_normalized, expires_at,
            consumed_at, invited_by_professional_id, invited_by_person_id, organization_id,
            claimed_person_id, claimed_professional_id, invite_kind, requested_org_role
     FROM invitations
     WHERE token_hash = $1
     FOR UPDATE`,
    [tokenHash],
  );
  const row = found.rows[0];
  if (found.rowCount === 0 || row === undefined) {
    throw new CollaborationError('invalid_token', 'Invitation is invalid or expired');
  }
  return row;
}

function toDomainInvitation(row: {
  invitation_id: string;
  flow: string;
  status: string;
  contact_point: string;
  invited_by_professional_id: string | null;
  organization_id: string | null;
  expires_at: Date;
  consumed_at: Date | null;
  claimed_person_id: string | null;
}): Invitation {
  return {
    invitationId: row.invitation_id as never,
    flow: row.flow as 'person_first' | 'professional_first',
    status: row.status as Invitation['status'],
    contactPoint: row.contact_point,
    invitedByProfessionalId: row.invited_by_professional_id as never,
    organizationId: row.organization_id as never,
    requestedCategories: [],
    issuedAt: 0,
    expiresAt: row.expires_at.getTime(),
    consumedAt: row.consumed_at?.getTime() ?? null,
    claimedPersonId: row.claimed_person_id as never,
  };
}

export async function createProfessionalToPersonInvitation(
  deps: InvitationDeps,
  actor: CollaborationActor,
  input: {
    readonly contactPoint: string;
    readonly organizationId?: string | null;
    readonly inviteKind?: 'care_relationship' | 'org_membership' | 'person_professional';
    readonly requestedOrgRole?: 'owner' | 'admin' | 'manager' | 'staff' | null;
    readonly ttlMs?: number;
  },
): Promise<{ invitationId: string; token: string }> {
  if (actor.professionalId === null) {
    throw new CollaborationError('forbidden', 'Professional principal required');
  }
  const email = normalizeEmail(input.contactPoint);
  const token = generateToken();
  const tokenHash = hashToken(token);
  const ttl = input.ttlMs ?? 7 * 24 * 60 * 60 * 1000;

  const invitationId = await runInSystemContext(
    deps.pool,
    'collab:invite_person',
    async (client) => {
      if (input.organizationId != null) {
        const mem = await client.query(
          `SELECT 1 FROM organization_memberships
           WHERE organization_id = $1 AND professional_id = $2 AND status = 'active'`,
          [input.organizationId, actor.professionalId],
        );
        if ((mem.rowCount ?? 0) === 0) {
          throw new CollaborationError('forbidden', 'Not an active organization member');
        }
      }
      issueInvitation({
        invitationId: 'tmp' as never,
        flow: 'professional_first',
        contactPoint: email,
        invitedByProfessionalId: actor.professionalId as never,
        organizationId: (input.organizationId ?? null) as never,
        requestedCategories: [],
        issuedAt: Date.now(),
        ttlMs: ttl,
      });
      const res = await client.query<{ invitation_id: string }>(
        `INSERT INTO invitations (
           flow, status, contact_point, invited_by_professional_id, organization_id,
           requested_categories, issued_at, expires_at, token_hash, recipient_normalized,
           invite_kind, requested_org_role
         ) VALUES ('professional_first', 'pending', $1, $2, $3, '{}', now(),
                   now() + ($4::text || ' milliseconds')::interval, $5, $6, $7, $8)
         RETURNING invitation_id`,
        [
          email,
          actor.professionalId,
          input.organizationId ?? null,
          String(ttl),
          tokenHash,
          email,
          input.inviteKind ?? 'care_relationship',
          input.requestedOrgRole ?? null,
        ],
      );
      const id = res.rows[0]?.invitation_id ?? '';
      const ev: CollaborationSecurityEvent = {
        eventType: 'invitation_created',
        invitationId: id,
        organizationId: input.organizationId ?? null,
        professionalId: actor.professionalId,
        actorPrincipalType: 'professional',
        actorPrincipalId: actor.professionalId,
        contactHint: contactHint(email),
        metadata: {
          direction: 'professional_to_person',
          inviteKind: input.inviteKind ?? 'care_relationship',
        },
      };
      await insertCollaborationEvent(client, ev);
      deps.onEvent?.(ev);
      return id;
    },
  );
  return { invitationId, token };
}

export async function createPersonToProfessionalInvitation(
  deps: InvitationDeps,
  actor: CollaborationActor,
  input: {
    readonly contactPoint: string;
    readonly collaborationContext?: string;
    readonly ttlMs?: number;
  },
): Promise<{ invitationId: string; token: string }> {
  if (actor.personId === null) {
    throw new CollaborationError('forbidden', 'Person principal required');
  }
  const personId = actor.personId;
  const email = normalizeEmail(input.contactPoint);
  const token = generateToken();
  const tokenHash = hashToken(token);
  const ttl = input.ttlMs ?? 7 * 24 * 60 * 60 * 1000;

  const invitationId = await runInSystemContext(
    deps.pool,
    'collab:invite_professional',
    async (client) => {
      issueInvitation({
        invitationId: 'tmp' as never,
        flow: 'person_first',
        contactPoint: email,
        invitedByProfessionalId: null,
        organizationId: null,
        requestedCategories: [],
        issuedAt: Date.now(),
        ttlMs: ttl,
      });
      const res = await client.query<{ invitation_id: string }>(
        `INSERT INTO invitations (
           flow, status, contact_point, invited_by_person_id,
           requested_categories, issued_at, expires_at, token_hash, recipient_normalized,
           invite_kind
         ) VALUES ('person_first', 'pending', $1, $2, '{}', now(),
                   now() + ($3::text || ' milliseconds')::interval, $4, $5, 'person_professional')
         RETURNING invitation_id`,
        [email, personId, String(ttl), tokenHash, email],
      );
      const id = res.rows[0]?.invitation_id ?? '';
      const ev: CollaborationSecurityEvent = {
        eventType: 'invitation_created',
        invitationId: id,
        personId,
        actorPrincipalType: 'person',
        actorPrincipalId: personId,
        contactHint: contactHint(email),
        metadata: {
          direction: 'person_to_professional',
          collaborationContext: input.collaborationContext ?? 'care_coordination',
        },
      };
      await insertCollaborationEvent(client, ev);
      deps.onEvent?.(ev);
      return id;
    },
  );
  return { invitationId, token };
}

/**
 * Claim invitation:
 * 1. lock row FOR UPDATE
 * 2. validate domain transitions + TTL + recipient
 * 3. resolve/create identity (I-17 no fork)
 * 4. create relationship / optional org membership invite acceptance
 * 5. consume invitation CAS
 * 6. audit — single transaction
 */
export async function claimCollaborationInvitation(
  deps: InvitationDeps,
  actor: CollaborationActor,
  input: { readonly token: string },
): Promise<{
  invitationId: string;
  flow: 'professional_first' | 'person_first';
  personId: string | null;
  professionalId: string | null;
  relationshipId: string | null;
}> {
  const tokenHash = hashToken(input.token);
  try {
    return await runInSystemContext(deps.pool, 'collab:claim_invitation', async (client) => {
      const row = await loadInvitationForUpdate(client, tokenHash);
      const expected = row.recipient_normalized ?? normalizeEmail(row.contact_point);
      const claimantEmail =
        actor.personId !== null || actor.professionalId !== null
          ? await loadActorEmail(client, actor)
          : '';
      if (normalizeEmail(claimantEmail) !== expected) {
        const ev: CollaborationSecurityEvent = {
          eventType: 'invitation_rejected',
          invitationId: row.invitation_id,
          actorPrincipalType: actor.personId !== null ? 'person' : 'professional',
          actorPrincipalId: actor.personId ?? actor.professionalId,
          contactHint: contactHint(claimantEmail || 'unknown'),
          metadata: { reason: 'wrong_recipient' },
        };
        await insertCollaborationEvent(client, ev);
        deps.onEvent?.(ev);
        throw new CollaborationError('wrong_recipient', 'Invitation is invalid or expired');
      }

      const now = Date.now();
      const pending = row.status === 'pending' && row.consumed_at === null;
      if (!pending) {
        if (row.status === 'accepted') {
          const ev: CollaborationSecurityEvent = {
            eventType: 'invitation_claimed',
            invitationId: row.invitation_id,
            metadata: { reason: 'replay' },
            actorPrincipalType: actor.personId !== null ? 'person' : 'professional',
            actorPrincipalId: actor.personId ?? actor.professionalId,
          };
          await insertCollaborationEvent(client, ev);
          throw new CollaborationError('invalid_token', 'Invitation is invalid or expired');
        }
        throw new CollaborationError('invalid_token', 'Invitation is invalid or expired');
      }
      if (now > row.expires_at.getTime()) {
        const d = toDomainInvitation(row);
        if (isInvitationExpired(d, now)) {
          await client.query(
            `UPDATE invitations SET status = 'expired' WHERE invitation_id = $1 AND status = 'pending'`,
            [row.invitation_id],
          );
          const ev: CollaborationSecurityEvent = {
            eventType: 'invitation_expired',
            invitationId: row.invitation_id,
            actorPrincipalType: actor.personId !== null ? 'person' : 'professional',
            actorPrincipalId: actor.personId ?? actor.professionalId,
          };
          await insertCollaborationEvent(client, ev);
          deps.onEvent?.(ev);
        }
        throw new CollaborationError('expired_token', 'Invitation is invalid or expired');
      }

      const domainInv = toDomainInvitation(row);

      if (row.flow === 'professional_first') {
        if (actor.personId === null) {
          throw new CollaborationError('wrong_recipient', 'Invitation is invalid or expired');
        }
        const personId = actor.personId;
        domainAcceptInvitation({
          invitation: domainInv,
          at: now,
          claimedPersonId: personId as never,
        });
        const consumed = await client.query(
          `UPDATE invitations
           SET status = 'accepted', consumed_at = to_timestamp($1 / 1000.0), claimed_person_id = $2
           WHERE invitation_id = $3 AND status = 'pending' AND consumed_at IS NULL
           RETURNING invitation_id`,
          [now, personId, row.invitation_id],
        );
        if (consumed.rowCount !== 1) {
          throw new CollaborationError('conflict', 'Invitation is invalid or expired');
        }

        let relationshipId: string | null = null;
        const professionalId = row.invited_by_professional_id;
        if (professionalId === null) {
          throw new CollaborationError('validation', 'Invitation missing inviter');
        }

        const careTeam = await client.query<{ care_team_id: string }>(
          `SELECT care_team_id FROM care_teams WHERE person_id = $1 AND status = 'open' LIMIT 1`,
          [personId],
        );
        let careTeamId = careTeam.rows[0]?.care_team_id ?? null;
        if (careTeamId === null) {
          const created = await client.query<{ care_team_id: string }>(
            `INSERT INTO care_teams (person_id, status) VALUES ($1, 'open') RETURNING care_team_id`,
            [personId],
          );
          careTeamId = created.rows[0]?.care_team_id ?? null;
          await insertCollaborationEvent(client, {
            eventType: 'care_team_created',
            personId,
            actorPrincipalType: 'system',
            metadata: { careTeamId },
          });
        }

        const existingMember = await client.query(
          `SELECT 1 FROM care_team_memberships
           WHERE care_team_id = $1 AND professional_id = $2 AND status = 'active'`,
          [careTeamId, professionalId],
        );
        if ((existingMember.rowCount ?? 0) === 0 && careTeamId !== null) {
          await client.query(
            `INSERT INTO care_team_memberships
               (care_team_id, person_id, professional_id, status, joined_at)
             VALUES ($1, $2, $3, 'active', now())`,
            [careTeamId, personId, professionalId],
          );
          await insertCollaborationEvent(client, {
            eventType: 'care_team_member_added',
            personId,
            professionalId,
            actorPrincipalType: 'system',
            metadata: { via: 'invitation' },
          });
        }

        relationshipId = await upsertRelationship(client, {
          personId,
          professionalId,
          careTeamId,
          organizationId: row.organization_id,
          invitationId: row.invitation_id,
          collaborationContext: 'care_coordination',
        });

        const ev: CollaborationSecurityEvent = {
          eventType: 'invitation_claimed',
          invitationId: row.invitation_id,
          personId,
          professionalId,
          organizationId: row.organization_id,
          actorPrincipalType: 'person',
          actorPrincipalId: personId,
          contactHint: contactHint(expected),
          metadata: { flow: 'professional_first', relationshipId },
        };
        await insertCollaborationEvent(client, ev);
        deps.onEvent?.(ev);

        return {
          invitationId: row.invitation_id,
          flow: 'professional_first' as const,
          personId,
          professionalId,
          relationshipId,
        };
      }

      if (actor.professionalId === null) {
        throw new CollaborationError('wrong_recipient', 'Invitation is invalid or expired');
      }
      if (row.invited_by_person_id === null) {
        throw new CollaborationError('validation', 'Invitation missing inviter');
      }
      const professionalId = actor.professionalId;
      const personId = row.invited_by_person_id;
      domainAcceptInvitation({
        invitation: domainInv,
        at: now,
        claimedPersonId: personId as never,
      });
      const consumed = await client.query(
        `UPDATE invitations
         SET status = 'accepted', consumed_at = to_timestamp($1 / 1000.0),
             claimed_person_id = $2, claimed_professional_id = $3
         WHERE invitation_id = $4 AND status = 'pending' AND consumed_at IS NULL
         RETURNING invitation_id`,
        [now, personId, professionalId, row.invitation_id],
      );
      if (consumed.rowCount !== 1) {
        throw new CollaborationError('conflict', 'Invitation is invalid or expired');
      }

      const careTeam = await client.query<{ care_team_id: string }>(
        `SELECT care_team_id FROM care_teams WHERE person_id = $1 AND status = 'open' LIMIT 1`,
        [personId],
      );
      const careTeamId = careTeam.rows[0]?.care_team_id ?? null;
      if (careTeamId !== null) {
        const existingMember = await client.query(
          `SELECT 1 FROM care_team_memberships
           WHERE care_team_id = $1 AND professional_id = $2 AND status = 'active'`,
          [careTeamId, professionalId],
        );
        if ((existingMember.rowCount ?? 0) === 0) {
          await client.query(
            `INSERT INTO care_team_memberships
               (care_team_id, person_id, professional_id, status, joined_at)
             VALUES ($1, $2, $3, 'active', now())`,
            [careTeamId, personId, professionalId],
          );
          await insertCollaborationEvent(client, {
            eventType: 'care_team_member_added',
            personId,
            professionalId,
            actorPrincipalType: 'system',
            metadata: { via: 'invitation' },
          });
        }
      }

      const relationshipId = await upsertRelationship(client, {
        personId,
        professionalId,
        careTeamId,
        organizationId: row.organization_id,
        invitationId: row.invitation_id,
        collaborationContext: 'care_coordination',
      });

      const ev: CollaborationSecurityEvent = {
        eventType: 'invitation_claimed',
        invitationId: row.invitation_id,
        personId,
        professionalId,
        actorPrincipalType: 'professional',
        actorPrincipalId: professionalId,
        contactHint: contactHint(expected),
        metadata: { flow: 'person_first', relationshipId },
      };
      await insertCollaborationEvent(client, ev);
      deps.onEvent?.(ev);

      return {
        invitationId: row.invitation_id,
        flow: 'person_first' as const,
        personId,
        professionalId,
        relationshipId,
      };
    });
  } catch (error) {
    throw toCollaborationError(error);
  }
}

async function loadActorEmail(client: PoolClient, actor: CollaborationActor): Promise<string> {
  const res = await client.query<{ email_normalized: string }>(
    `SELECT email_normalized FROM accounts WHERE account_id = $1`,
    [actor.accountId],
  );
  return res.rows[0]?.email_normalized ?? '';
}

async function upsertRelationship(
  client: PoolClient,
  input: {
    personId: string;
    professionalId: string;
    careTeamId: string | null;
    organizationId: string | null;
    invitationId: string;
    collaborationContext: string;
  },
): Promise<string> {
  const existing = await client.query<{ relationship_id: string }>(
    `SELECT relationship_id FROM person_professional_relationships
     WHERE person_id = $1 AND professional_id = $2 AND status = 'active'
     FOR UPDATE`,
    [input.personId, input.professionalId],
  );
  if ((existing.rowCount ?? 0) > 0) {
    const id = existing.rows[0]?.relationship_id ?? '';
    await client.query(
      `UPDATE person_professional_relationships
       SET care_team_id = COALESCE($2, care_team_id),
           organization_id = COALESCE($3, organization_id)
       WHERE relationship_id = $1`,
      [id, input.careTeamId, input.organizationId],
    );
    await insertCollaborationEvent(client, {
      eventType: 'relationship_started',
      personId: input.personId,
      professionalId: input.professionalId,
      invitationId: input.invitationId,
      actorPrincipalType: 'system',
      metadata: { reused: true },
    });
    return id;
  }
  const inserted = await client.query<{ relationship_id: string }>(
    `INSERT INTO person_professional_relationships
       (person_id, professional_id, care_team_id, organization_id, collaboration_context,
        status, started_at, created_by_invitation_id)
     VALUES ($1, $2, $3, $4, $5, 'active', now(), $6)
     ON CONFLICT DO NOTHING
     RETURNING relationship_id`,
    [
      input.personId,
      input.professionalId,
      input.careTeamId,
      input.organizationId,
      input.collaborationContext,
      input.invitationId,
    ],
  );
  if ((inserted.rowCount ?? 0) === 0) {
    const pick = await client.query<{ relationship_id: string }>(
      `SELECT relationship_id FROM person_professional_relationships
       WHERE person_id = $1 AND professional_id = $2 AND status = 'active'`,
      [input.personId, input.professionalId],
    );
    return pick.rows[0]?.relationship_id ?? '';
  }
  await insertCollaborationEvent(client, {
    eventType: 'relationship_started',
    personId: input.personId,
    professionalId: input.professionalId,
    invitationId: input.invitationId,
    actorPrincipalType: 'system',
    metadata: { reused: false },
  });
  return inserted.rows[0]?.relationship_id ?? '';
}

export async function revokeCollaborationInvitation(
  deps: InvitationDeps,
  actor: CollaborationActor,
  input: { readonly invitationId: string },
): Promise<void> {
  await runInSystemContext(deps.pool, 'collab:revoke_invitation', async (client) => {
    const found = await client.query<{
      invitation_id: string;
      status: string;
      invited_by_professional_id: string | null;
      invited_by_person_id: string | null;
      consumed_at: Date | null;
      contact_point: string;
      expires_at: Date;
    }>(
      `SELECT invitation_id, status, invited_by_professional_id, invited_by_person_id,
              consumed_at, contact_point, expires_at
       FROM invitations WHERE invitation_id = $1 FOR UPDATE`,
      [input.invitationId],
    );
    const row = found.rows[0];
    if (row === undefined) {
      throw new CollaborationError('not_found', 'Invitation not found');
    }
    const isInviterProf =
      actor.professionalId !== null && actor.professionalId === row.invited_by_professional_id;
    const isInviterPerson = actor.personId !== null && actor.personId === row.invited_by_person_id;
    if (!isInviterProf && !isInviterPerson) {
      throw new CollaborationError('forbidden', 'Not permitted');
    }
    revokeInvitation(
      toDomainInvitation({
        invitation_id: row.invitation_id,
        flow: '',
        status: row.status,
        contact_point: row.contact_point,
        invited_by_professional_id: row.invited_by_professional_id,
        organization_id: null,
        expires_at: row.expires_at,
        consumed_at: row.consumed_at,
        claimed_person_id: null,
      }),
    );
    await client.query(
      `UPDATE invitations
       SET status = 'revoked', consumed_at = now(), revoked_at = now()
       WHERE invitation_id = $1 AND status = 'pending' AND consumed_at IS NULL`,
      [row.invitation_id],
    );
    const ev: CollaborationSecurityEvent = {
      eventType: 'invitation_revoked',
      invitationId: row.invitation_id,
      actorPrincipalType: actor.personId !== null ? 'person' : 'professional',
      actorPrincipalId: actor.personId ?? actor.professionalId,
      contactHint: contactHint(row.contact_point),
    };
    await insertCollaborationEvent(client, ev);
    deps.onEvent?.(ev);
  });
}

export async function rejectCollaborationInvitation(
  deps: InvitationDeps,
  actor: CollaborationActor,
  input: { readonly invitationId: string },
): Promise<void> {
  await runInSystemContext(deps.pool, 'collab:reject_invitation', async (client) => {
    const found = await client.query<{
      invitation_id: string;
      status: string;
      contact_point: string;
      recipient_normalized: string | null;
      invited_by_professional_id: string | null;
      invited_by_person_id: string | null;
      expires_at: Date;
      consumed_at: Date | null;
      claimed_person_id: string | null;
    }>(
      `SELECT invitation_id, status, contact_point, recipient_normalized,
              invited_by_professional_id, invited_by_person_id, expires_at, consumed_at, claimed_person_id
       FROM invitations WHERE invitation_id = $1 FOR UPDATE`,
      [input.invitationId],
    );
    const row = found.rows[0];
    if (row === undefined) {
      throw new CollaborationError('not_found', 'Invitation not found');
    }
    const email = await loadActorEmail(client, actor);
    const expected = row.recipient_normalized ?? normalizeEmail(row.contact_point);
    if (normalizeEmail(email) !== expected) {
      throw new CollaborationError('forbidden', 'Not permitted');
    }
    rejectInvitation(
      toDomainInvitation({
        invitation_id: row.invitation_id,
        flow: '',
        status: row.status,
        contact_point: row.contact_point,
        invited_by_professional_id: row.invited_by_professional_id,
        organization_id: null,
        expires_at: row.expires_at,
        consumed_at: row.consumed_at,
        claimed_person_id: row.claimed_person_id,
      }),
      Date.now(),
    );
    await client.query(
      `UPDATE invitations
       SET status = 'rejected', consumed_at = now(), rejected_at = now()
       WHERE invitation_id = $1 AND status = 'pending' AND consumed_at IS NULL`,
      [row.invitation_id],
    );
    const ev: CollaborationSecurityEvent = {
      eventType: 'invitation_rejected',
      invitationId: row.invitation_id,
      actorPrincipalType: actor.personId !== null ? 'person' : 'professional',
      actorPrincipalId: actor.personId ?? actor.professionalId,
      contactHint: contactHint(row.contact_point),
    };
    await insertCollaborationEvent(client, ev);
    deps.onEvent?.(ev);
  });
}

export { dbFlow };
