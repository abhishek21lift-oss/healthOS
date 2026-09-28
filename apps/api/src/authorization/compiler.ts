/**
 * AccessGrant compiler persistence (Phase 5).
 * Deterministic domain compile → UPSERT access_grants under system context.
 * Idempotent: same (person, grantee, category, purpose) unique key → single active row.
 */
import {
  candidateKey as domainCandidateKey,
  compileAccessGrants as domainCompile,
  type ConsentRevision,
  type MembershipBasis,
} from '@health-os/domain';
import type { AccessGrant as DomainAccessGrant } from '@health-os/domain';
import { runInSystemContext, type PoolClient } from '@health-os/database';

import { emitAuthorizationEvent, type AuthorizationDeps } from './types.js';

export interface CompileGrantsResult {
  readonly compiled: number;
  readonly revoked: number;
}

async function loadMembership(
  client: PoolClient,
  personId: string,
  professionalId: string,
): Promise<MembershipBasis | null> {
  const res = await client.query<{
    membership_id: string;
    status: string;
  }>(
    `SELECT membership_id, status
     FROM care_team_memberships
     WHERE person_id = $1 AND professional_id = $2
     ORDER BY joined_at DESC
     LIMIT 1`,
    [personId, professionalId],
  );
  const row = res.rows[0];
  if (row === undefined) {
    return null;
  }
  return {
    membershipId: row.membership_id as never,
    relationship: 'care_team_member',
    status: row.status === 'active' ? 'active' : row.status === 'ended' ? 'ended' : 'inactive',
  };
}

async function upsertGrant(client: PoolClient, grant: DomainAccessGrant): Promise<void> {
  await client.query(
    `INSERT INTO access_grants (
       access_grant_id, person_id, grantee_professional_id, category, purpose, status,
       relationship_class, membership_id, consent_revision_id,
       effective_from, effective_until, issued_at, revoked_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               to_timestamp($10 / 1000.0),
               CASE WHEN $11::bigint IS NULL THEN NULL ELSE to_timestamp($11::bigint / 1000.0) END,
               to_timestamp($12 / 1000.0), NULL)
     ON CONFLICT (person_id, grantee_professional_id, category, purpose) DO UPDATE SET
       status = EXCLUDED.status,
       relationship_class = EXCLUDED.relationship_class,
       membership_id = EXCLUDED.membership_id,
       consent_revision_id = EXCLUDED.consent_revision_id,
       effective_from = EXCLUDED.effective_from,
       effective_until = EXCLUDED.effective_until,
       issued_at = EXCLUDED.issued_at,
       revoked_at = NULL`,
    [
      crypto.randomUUID(),
      grant.personId,
      grant.granteeProfessionalId,
      grant.category,
      grant.purpose,
      grant.status,
      grant.relationship,
      grant.membershipId,
      grant.consentRevisionId,
      grant.window.effectiveFrom,
      grant.window.effectiveUntil,
      grant.issuedAt,
    ],
  );
}

/**
 * Compile grants for an active consent revision and persist them.
 * Returns counts for audit. Idempotent under unique key.
 */
export async function compileAndPersistGrants(
  deps: Pick<AuthorizationDeps, 'pool' | 'onEvent'>,
  input: {
    readonly revision: ConsentRevision;
    readonly personId: string;
    readonly granteeProfessionalId: string;
  },
): Promise<CompileGrantsResult> {
  return runInSystemContext(deps.pool, 'authz:compile_grants', async (client) => {
    const membership = await loadMembership(client, input.personId, input.granteeProfessionalId);
    const grants = domainCompile({
      consentRevision: input.revision,
      membership,
      grantIdFactory: () => crypto.randomUUID() as never,
    });

    const desired = new Set(grants.map((g) => domainCandidateKey(g)));
    const existing = await client.query<{
      access_grant_id: string;
      category: string;
      purpose: string;
    }>(
      `SELECT access_grant_id, category, purpose
       FROM access_grants
       WHERE person_id = $1 AND grantee_professional_id = $2 AND status = 'active'`,
      [input.personId, input.granteeProfessionalId],
    );

    let revoked = 0;
    for (const row of existing.rows) {
      const key = `${row.category}::${row.purpose}`;
      if (!desired.has(key)) {
        await client.query(
          `UPDATE access_grants
           SET status = 'revoked', effective_until = now(), revoked_at = now()
           WHERE access_grant_id = $1 AND status = 'active'`,
          [row.access_grant_id],
        );
        revoked += 1;
      }
    }

    for (const grant of grants) {
      await upsertGrant(client, grant);
    }

    if (grants.length > 0 || revoked > 0) {
      await emitAuthorizationEvent(client, deps, {
        eventType: grants.length > 0 ? 'grants_compiled' : 'grants_revoked',
        personId: input.personId,
        professionalId: input.granteeProfessionalId,
        actorPrincipalType: 'system',
        actorPrincipalId: '00000000-0000-0000-0000-000000000001',
        metadata: {
          purpose: 'treatment',
          compiled: grants.length,
          revoked,
          revisionId: input.revision.revisionId,
        },
      });
    }

    return { compiled: grants.length, revoked };
  });
}

/** Revoke all active grants tied to a consent (person revoke fan-out). */
export async function revokeGrantsForConsentId(
  deps: Pick<AuthorizationDeps, 'pool' | 'onEvent'>,
  input: { readonly consentId: string; readonly personId: string },
): Promise<number> {
  return runInSystemContext(deps.pool, 'authz:revoke_grants', async (client) => {
    const res = await client.query(
      `UPDATE access_grants ag
       SET status = 'revoked', effective_until = now(), revoked_at = now()
       FROM consent_revisions cr
       WHERE ag.consent_revision_id = cr.consent_revision_id
         AND cr.consent_id = $1
         AND ag.person_id = $2
         AND ag.status = 'active'`,
      [input.consentId, input.personId],
    );
    const count = res.rowCount ?? 0;
    if (count > 0) {
      await emitAuthorizationEvent(client, deps, {
        eventType: 'grants_revoked',
        personId: input.personId,
        actorPrincipalType: 'system',
        actorPrincipalId: '00000000-0000-0000-0000-000000000001',
        metadata: { purpose: 'treatment', consentId: input.consentId, revoked: count },
      });
    }
    return count;
  });
}

/** Revoke grants for an ended care-team membership (I-9 membership end path). */
export async function revokeGrantsForMembership(
  deps: Pick<AuthorizationDeps, 'pool' | 'onEvent'>,
  input: { readonly membershipId: string; readonly personId?: string | null },
): Promise<number> {
  return runInSystemContext(deps.pool, 'authz:revoke_membership_grants', async (client) => {
    const res = await client.query(
      `UPDATE access_grants
       SET status = 'revoked', effective_until = now(), revoked_at = now()
       WHERE membership_id = $1 AND status = 'active'`,
      [input.membershipId],
    );
    const count = res.rowCount ?? 0;
    if (count > 0) {
      await emitAuthorizationEvent(client, deps, {
        eventType: 'membership_grants_revoked',
        personId: input.personId ?? null,
        actorPrincipalType: 'system',
        actorPrincipalId: '00000000-0000-0000-0000-000000000001',
        metadata: { purpose: 'treatment', membershipId: input.membershipId, revoked: count },
      });
    }
    return count;
  });
}
