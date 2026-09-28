/**
 * Health authorization decision (Phase 5 PEP entry).
 * Loads server-derived AuthorizationContext, evaluates policy, audits allow/deny.
 * Does not replace PostgreSQL RLS — both must allow for a successful health read.
 */
import type { AccessGrant } from '@health-os/domain';
import {
  evaluateAuthorization,
  type AuthorizationAction,
  type AuthorizationDecision,
  type AuthorizationContext,
} from '@health-os/permissions';
import { beginRequest, clearRequest, withClient, type Pool } from '@health-os/database';

import {
  AuthorizationError,
  emitAuthorizationEvent,
  type AuthorizationActor,
  type AuthorizationDeps,
} from './types.js';

export interface AuthorizeHealthInput {
  readonly personId: string;
  readonly category: string;
  readonly purpose: string;
  readonly action?: AuthorizationAction;
  readonly requestId?: string;
}

export interface AuthorizeHealthResult {
  readonly decision: AuthorizationDecision;
  readonly context: AuthorizationContext;
  readonly evaluatedInMs: number;
}

async function loadContextFacts(
  pool: Pool,
  actor: AuthorizationActor,
  input: AuthorizeHealthInput,
): Promise<{
  relationshipActive: boolean;
  membershipActive: boolean;
  consentActive: boolean;
  grant: AccessGrant | null;
  at: number;
}> {
  const at = Date.now();
  return withClient(pool, async (client) => {
    await client.query('BEGIN');
    try {
      if (actor.professionalId !== null) {
        await beginRequest(client, {
          principalType: 'professional',
          principalId: actor.professionalId,
          purpose: input.purpose,
          ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
        });
      } else if (actor.personId !== null) {
        await beginRequest(client, {
          principalType: 'person',
          principalId: actor.personId,
          purpose: input.purpose,
          ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
        });
      }

      let relationshipActive = false;
      let membershipActive = false;
      let consentActive = false;
      let grant: AccessGrant | null = null;

      if (actor.professionalId !== null) {
        const rel = await client.query(
          `SELECT 1 FROM person_professional_relationships
           WHERE person_id = $1 AND professional_id = $2 AND status = 'active'
           LIMIT 1`,
          [input.personId, actor.professionalId],
        );
        relationshipActive = (rel.rowCount ?? 0) > 0;

        const mem = await client.query(
          `SELECT 1 FROM care_team_memberships
           WHERE person_id = $1 AND professional_id = $2 AND status = 'active'
           LIMIT 1`,
          [input.personId, actor.professionalId],
        );
        membershipActive = (mem.rowCount ?? 0) > 0;

        const consent = await client.query(
          `SELECT 1 FROM consent_revisions cr
           JOIN consents c ON c.consent_id = cr.consent_id
           WHERE cr.person_id = $1 AND cr.grantee_professional_id = $2
             AND cr.status = 'active' AND c.status = 'active'
             AND cr.effective_from <= now()
             AND (cr.effective_until IS NULL OR cr.effective_until >= now())
             AND $3 = ANY(cr.categories) AND $4 = ANY(cr.purposes)
           LIMIT 1`,
          [input.personId, actor.professionalId, input.category, input.purpose],
        );
        consentActive = (consent.rowCount ?? 0) > 0;

        const g = await client.query<{
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
          `SELECT access_grant_id, person_id, grantee_professional_id, category, purpose, status,
                  relationship_class, membership_id, consent_revision_id,
                  effective_from, effective_until, issued_at
           FROM access_grants
           WHERE person_id = $1 AND grantee_professional_id = $2
             AND category = $3 AND purpose = $4
           ORDER BY issued_at DESC
           LIMIT 1`,
          [input.personId, actor.professionalId, input.category, input.purpose],
        );
        const row = g.rows[0];
        if (row !== undefined) {
          grant = {
            grantId: row.access_grant_id as never,
            personId: row.person_id as never,
            granteeProfessionalId: row.grantee_professional_id as never,
            category: row.category as never,
            purpose: row.purpose as never,
            status: row.status as never,
            relationship: row.relationship_class as never,
            membershipId: (row.membership_id ?? 'none') as never,
            consentRevisionId: (row.consent_revision_id ?? 'none') as never,
            window: {
              effectiveFrom: row.effective_from.getTime(),
              effectiveUntil: row.effective_until?.getTime() ?? null,
            },
            issuedAt: row.issued_at.getTime(),
          };
        }
      } else if (actor.personId !== null) {
        relationshipActive = actor.personId === input.personId;
        membershipActive = actor.personId === input.personId;
        consentActive = true;
      }

      await client.query('COMMIT');
      return { relationshipActive, membershipActive, consentActive, grant, at };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await clearRequest(client);
    }
  });
}

async function auditDecision(
  deps: Pick<AuthorizationDeps, 'pool' | 'onEvent'>,
  actor: AuthorizationActor,
  input: AuthorizeHealthInput,
  decision: AuthorizationDecision,
  grantId: string | null,
): Promise<void> {
  const actorType = actor.professionalId !== null ? 'professional' : 'person';
  const actorId = actor.professionalId ?? actor.personId;
  if (actorId === null) {
    return;
  }

  await withClient(deps.pool, async (client) => {
    await client.query('BEGIN');
    try {
      await beginRequest(client, {
        principalType: actorType === 'professional' ? 'professional' : 'person',
        principalId: actorId,
        purpose: input.purpose,
        ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
      });
      const decisionWord = decision.allowed ? 'allow' : 'deny';
      await client.query(
        `INSERT INTO audit_logs (
           actor_principal_type, actor_principal_id, action, resource_type, resource_id,
           person_id, purpose, access_decision, access_grant_id, request_id, severity, metadata
         ) VALUES ($1, $2, $3, 'health_read', NULL, $4, $5, $6, $7, $8, 'info', $9::jsonb)`,
        [
          actorType,
          actorId,
          `health:${input.action ?? 'read'}:${input.category}`,
          input.personId,
          input.purpose,
          decisionWord,
          grantId,
          input.requestId ?? null,
          JSON.stringify({
            category: input.category,
            purpose: input.purpose,
            ...(decision.allowed ? {} : { denyReason: decision.reason }),
          }),
        ],
      );
      if (decision.allowed) {
        await client.query(
          `INSERT INTO person_access_logs (
             person_id, accessor_type, accessor_id, action, resource_type, resource_id, purpose, request_id
           ) VALUES ($1, $2, $3, $4, 'health', NULL, $5, $6)`,
          [
            input.personId,
            actorType,
            actorId,
            `read:${input.category}`,
            input.purpose,
            input.requestId ?? null,
          ],
        );
      }
      await client.query('COMMIT');
      await emitAuthorizationEvent(client, deps, {
        eventType: decision.allowed ? 'health_access_allowed' : 'health_access_denied',
        personId: input.personId,
        professionalId: actor.professionalId,
        actorPrincipalType: actorType,
        actorPrincipalId: actorId,
        requestId: input.requestId ?? null,
        metadata: {
          purpose: input.purpose,
          category: input.category,
          ...(decision.allowed ? { grantId: decision.grantId } : { denyReason: decision.reason }),
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await clearRequest(client);
    }
  });
}

/**
 * Evaluate health authorization for a session actor.
 * ALLOW only when policy chain is complete; subsequent SQL under RLS is the second gate.
 */
export async function authorizeHealthAccess(
  deps: AuthorizationDeps,
  actor: AuthorizationActor,
  input: AuthorizeHealthInput,
): Promise<AuthorizeHealthResult> {
  if (input.purpose.trim().length === 0) {
    throw new AuthorizationError('denied', 'Purpose required', {
      denyReason: 'PURPOSE_REQUIRED',
    });
  }
  if (actor.personId === null && actor.professionalId === null) {
    const decision: AuthorizationDecision = {
      allowed: false,
      reason: 'NO_AUTHENTICATED_PRINCIPAL',
    };
    return {
      decision,
      context: {
        principal: null,
        personId: input.personId,
        action: input.action ?? 'read',
        purpose: null,
        category: input.category,
        relationshipActive: false,
        membershipActive: false,
        consentActive: false,
        grant: null,
        at: Date.now(),
      },
      evaluatedInMs: 0,
    };
  }

  const facts = await loadContextFacts(deps.pool, actor, input);
  const started = Date.now();
  const principalType =
    actor.professionalId !== null ? ('professional' as const) : ('person' as const);
  const principalId = actor.professionalId ?? actor.personId ?? '';

  const context: AuthorizationContext = {
    principal: { type: principalType, id: principalId },
    personId: input.personId,
    action: input.action ?? 'read',
    purpose: input.purpose as never,
    category: input.category,
    relationshipActive: facts.relationshipActive,
    membershipActive: facts.membershipActive,
    consentActive: facts.consentActive,
    grant: facts.grant,
    at: facts.at,
  };

  const decision = evaluateAuthorization(context);
  const evaluatedInMs = Date.now() - started;

  const grantIdForAudit = decision.allowed && decision.grantId !== 'self' ? decision.grantId : null;
  await auditDecision(deps, actor, input, decision, grantIdForAudit);

  return { decision, context, evaluatedInMs };
}

/**
 * Read health rows under principal + purpose RLS context after policy ALLOW.
 * If PostgreSQL rejects the query → DENY (never bypass RLS).
 */
export async function readHealthRowsAsPrincipal(
  deps: Pick<AuthorizationDeps, 'pool'>,
  actor: AuthorizationActor,
  input: AuthorizeHealthInput & {
    readonly sql: string;
    readonly params?: readonly unknown[];
  },
): Promise<{
  readonly allowedByRls: boolean;
  readonly rows: readonly Record<string, unknown>[];
}> {
  if (input.purpose.length === 0) {
    throw new AuthorizationError('denied', 'Purpose required', {
      denyReason: 'PURPOSE_REQUIRED',
    });
  }
  return withClient(deps.pool, async (client) => {
    await client.query('BEGIN');
    try {
      const principalType = actor.professionalId !== null ? 'professional' : 'person';
      const principalId = actor.professionalId ?? actor.personId;
      if (principalId === null) {
        throw new AuthorizationError('forbidden', 'Principal required');
      }
      await beginRequest(client, {
        principalType,
        principalId,
        purpose: input.purpose,
        ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
      });
      const res = await client.query(input.sql, [...(input.params ?? [])]);
      await client.query('COMMIT');
      return { allowedByRls: true, rows: res.rows as readonly Record<string, unknown>[] };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await clearRequest(client);
    }
  });
}
