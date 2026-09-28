/**
 * Phase 5 consent persistence + AccessGrant compiler sync (ADR-0006).
 *
 * - Person-issued consent: issue / narrow / revoke (domain state machines).
 * - Same transaction: insert consent_revisions, reconcile access_grants,
 *   write audit_logs (I-10). Revoke ⇒ grants revoked in-tx (deny on next request).
 * - AccessRequest: proposal only; accept may materialize first consent.
 */
import {
  acceptAccessRequest as domainAcceptAccessRequest,
  compileAccessGrants,
  createAccessRequest as domainCreateAccessRequest,
  issueConsent as domainIssueConsent,
  narrowConsentScope as domainNarrowConsentScope,
  rejectAccessRequest as domainRejectAccessRequest,
  revokeAccessGrant,
  revokeConsent as domainRevokeConsent,
  withdrawAccessRequest as domainWithdrawAccessRequest,
  type AccessCategory,
  type AccessGrant,
  type AccessPurpose,
  type Consent,
  type ConsentRevision,
  type RelationshipClass,
} from '@health-os/domain';
import { runInSystemContext, type PoolClient } from '@health-os/database';

import {
  insertConsentAudit,
  SYSTEM_PRINCIPAL_ID,
  toConsentError,
  ConsentError,
  type ConsentActor,
  type ConsentDeps,
} from './types.js';

export interface ConsentScopeInput {
  readonly categories: readonly AccessCategory[];
  readonly purposes: readonly AccessPurpose[];
}

function requirePersonActor(actor: ConsentActor): string {
  if (actor.personId === null) {
    throw new ConsentError('forbidden', 'Person principal required');
  }
  return actor.personId;
}

function requireProfessionalActor(actor: ConsentActor): string {
  if (actor.professionalId === null) {
    throw new ConsentError('forbidden', 'Professional principal required');
  }
  return actor.professionalId;
}

function toMs(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return Date.parse(value);
}

interface ConsentRow {
  consent_id: string;
  person_id: string;
  grantee_professional_id: string;
  status: string;
}

interface RevisionRow {
  consent_revision_id: string;
  consent_id: string;
  revision_number: number;
  person_id: string;
  grantee_professional_id: string;
  categories: string[];
  purposes: string[];
  status: string;
  effective_from: Date;
  effective_until: Date | null;
  issued_at: Date;
  issued_by_person_id: string;
  supersedes_revision_id: string | null;
}

interface MembershipRow {
  membership_id: string;
  status: string;
}

async function loadMembership(
  client: PoolClient,
  personId: string,
  professionalId: string,
): Promise<MembershipRow | null> {
  const res = await client.query<MembershipRow>(
    `SELECT membership_id, status
     FROM care_team_memberships
     WHERE person_id = $1 AND professional_id = $2 AND status = 'active'
     LIMIT 1`,
    [personId, professionalId],
  );
  return res.rows[0] ?? null;
}

async function loadConsentRows(
  client: PoolClient,
  personId: string,
  granteeProfessionalId: string,
): Promise<{ consent: ConsentRow | null; revisions: RevisionRow[] }> {
  const consentRes = await client.query<ConsentRow>(
    `SELECT consent_id, person_id, grantee_professional_id, status
     FROM consents
     WHERE person_id = $1 AND grantee_professional_id = $2
     FOR UPDATE`,
    [personId, granteeProfessionalId],
  );
  const consent = consentRes.rows[0] ?? null;
  if (consent === null) {
    return { consent: null, revisions: [] };
  }
  const revRes = await client.query<RevisionRow>(
    `SELECT consent_revision_id, consent_id, revision_number, person_id,
            grantee_professional_id, categories, purposes, status,
            effective_from, effective_until, issued_at, issued_by_person_id,
            supersedes_revision_id
     FROM consent_revisions
     WHERE consent_id = $1
     ORDER BY revision_number ASC`,
    [consent.consent_id],
  );
  return { consent, revisions: revRes.rows };
}

function toDomainConsent(consent: ConsentRow, revisions: RevisionRow[]): Consent {
  return {
    consentId: consent.consent_id as never,
    personId: consent.person_id as never,
    granteeProfessionalId: consent.grantee_professional_id as never,
    status: consent.status as Consent['status'],
    revisions: revisions.map((r) => ({
      revisionId: r.consent_revision_id as never,
      consentId: r.consent_id as never,
      revisionNumber: r.revision_number,
      personId: r.person_id as never,
      granteeProfessionalId: r.grantee_professional_id as never,
      scope: {
        categories: r.categories as AccessCategory[],
        purposes: r.purposes as AccessPurpose[],
      },
      status: r.status as ConsentRevision['status'],
      window: {
        effectiveFrom: toMs(r.effective_from),
        effectiveUntil: r.effective_until === null ? null : toMs(r.effective_until),
      },
      issuedAt: toMs(r.issued_at),
      issuedByPersonId: r.issued_by_person_id as never,
      supersedesRevisionId: r.supersedes_revision_id as never,
    })),
  };
}

function latestRevision(consent: Consent): ConsentRevision {
  const last = consent.revisions[consent.revisions.length - 1];
  if (last === undefined) {
    throw new ConsentError('invalid_state', 'Consent has no revisions');
  }
  return last;
}

function grantIdFactory(): never {
  return crypto.randomUUID() as never;
}

async function insertRevisionRow(client: PoolClient, revision: ConsentRevision): Promise<void> {
  await client.query(
    `INSERT INTO consent_revisions (
       consent_revision_id, consent_id, revision_number, person_id,
       grantee_professional_id, categories, purposes, status,
       effective_from, effective_until, issued_at, issued_by_person_id,
       supersedes_revision_id
     ) VALUES ($1, $2, $3, $4, $5, $6::text[], $7::text[], $8,
               to_timestamp($9 / 1000.0), CASE WHEN $10::bigint IS NULL THEN NULL ELSE to_timestamp($10::bigint / 1000.0) END,
               to_timestamp($11 / 1000.0), $12, $13)`,
    [
      revision.revisionId,
      revision.consentId,
      revision.revisionNumber,
      revision.personId,
      revision.granteeProfessionalId,
      revision.scope.categories,
      revision.scope.purposes,
      revision.status,
      revision.window.effectiveFrom,
      revision.window.effectiveUntil,
      revision.issuedAt,
      revision.issuedByPersonId,
      revision.supersedesRevisionId,
    ],
  );
}

async function upsertActiveGrants(
  client: PoolClient,
  grants: readonly AccessGrant[],
  relationship: RelationshipClass,
  membershipId: string | null,
): Promise<void> {
  for (const g of grants) {
    await client.query(
      `INSERT INTO access_grants (
         access_grant_id, person_id, grantee_professional_id, category, purpose,
         status, relationship_class, membership_id, consent_revision_id,
         effective_from, effective_until, issued_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                 to_timestamp($10 / 1000.0),
                 CASE WHEN $11::bigint IS NULL THEN NULL ELSE to_timestamp($11::bigint / 1000.0) END,
                 to_timestamp($12 / 1000.0))
       ON CONFLICT (person_id, grantee_professional_id, category, purpose)
       DO UPDATE SET
         status = EXCLUDED.status,
         relationship_class = EXCLUDED.relationship_class,
         membership_id = EXCLUDED.membership_id,
         consent_revision_id = EXCLUDED.consent_revision_id,
         effective_from = EXCLUDED.effective_from,
         effective_until = EXCLUDED.effective_until,
         issued_at = EXCLUDED.issued_at,
         revoked_at = NULL`,
      [
        g.grantId,
        g.personId,
        g.granteeProfessionalId,
        g.category,
        g.purpose,
        g.status,
        relationship,
        membershipId,
        g.consentRevisionId,
        g.window.effectiveFrom,
        g.window.effectiveUntil,
        g.issuedAt,
      ],
    );
  }
}

async function revokeActiveGrantsForPair(
  client: PoolClient,
  personId: string,
  granteeProfessionalId: string,
  atMs: number,
  onlyRevisionId?: string,
): Promise<number> {
  const res = await client.query(
    `UPDATE access_grants
     SET status = 'revoked',
         effective_until = LEAST(
           COALESCE(effective_until, to_timestamp($4 / 1000.0)),
           to_timestamp($4 / 1000.0)
         ),
         revoked_at = to_timestamp($4 / 1000.0)
     WHERE person_id = $1
       AND grantee_professional_id = $2
       AND status = 'active'
       AND ($3::uuid IS NULL OR consent_revision_id = $3::uuid)`,
    [personId, granteeProfessionalId, onlyRevisionId ?? null, atMs],
  );
  return res.rowCount ?? 0;
}

async function revokeGrantsOutsideScope(
  client: PoolClient,
  personId: string,
  granteeProfessionalId: string,
  keepCategories: readonly string[],
  keepPurposes: readonly string[],
  atMs: number,
): Promise<void> {
  // Revoke active grants whose (category, purpose) is no longer fully in scope,
  // or whose category/purpose fell out after narrowing. Then upsert survivors.
  await client.query(
    `UPDATE access_grants
     SET status = 'revoked',
         effective_until = to_timestamp($4 / 1000.0),
         revoked_at = to_timestamp($4 / 1000.0)
     WHERE person_id = $1
       AND grantee_professional_id = $2
       AND status = 'active'
       AND NOT (
         category = ANY($3::text[])
         AND purpose = ANY($5::text[])
       )`,
    [personId, granteeProfessionalId, [...keepCategories], atMs, [...keepPurposes]],
  );
}

async function ensureConsentRow(
  client: PoolClient,
  personId: string,
  granteeProfessionalId: string,
): Promise<string> {
  const existing = await client.query<{ consent_id: string }>(
    `SELECT consent_id FROM consents
     WHERE person_id = $1 AND grantee_professional_id = $2`,
    [personId, granteeProfessionalId],
  );
  const id = existing.rows[0]?.consent_id;
  if (id !== undefined) {
    return id;
  }
  const inserted = await client.query<{ consent_id: string }>(
    `INSERT INTO consents (person_id, grantee_professional_id, status)
     VALUES ($1, $2, 'active')
     RETURNING consent_id`,
    [personId, granteeProfessionalId],
  );
  const newId = inserted.rows[0]?.consent_id;
  if (newId === undefined) {
    throw new ConsentError('conflict', 'Unable to create consent');
  }
  return newId;
}

/**
 * Issue (or re-issue after prior full revoke) person consent and compile grants.
 * Person principal required. Same tx: revision + grants + audit.
 */
export async function issuePersonConsent(
  deps: ConsentDeps,
  actor: ConsentActor,
  input: {
    readonly granteeProfessionalId: string;
    readonly scope: ConsentScopeInput;
    readonly effectiveFrom?: number;
    readonly effectiveUntil?: number | null;
  },
): Promise<{ consentId: string; revisionId: string; grantCount: number }> {
  const personId = requirePersonActor(actor);
  try {
    return await runInSystemContext(deps.pool, 'consent:issue', async (client) => {
      const now = Date.now();
      const { consent, revisions } = await loadConsentRows(
        client,
        personId,
        input.granteeProfessionalId,
      );
      let consentId: string;
      let domain: Consent;
      if (consent === null) {
        consentId = await ensureConsentRow(client, personId, input.granteeProfessionalId);
        domain = domainIssueConsent({
          consentId: consentId as never,
          revisionId: crypto.randomUUID() as never,
          personId: personId as never,
          granteeProfessionalId: input.granteeProfessionalId as never,
          scope: input.scope,
          window: {
            effectiveFrom: input.effectiveFrom ?? now,
            effectiveUntil: input.effectiveUntil ?? null,
          },
          issuedAt: now,
        });
      } else {
        if (consent.status === 'active' && revisions.some((r) => r.status === 'active')) {
          throw new ConsentError('conflict', 'Active consent already exists; use narrow or revoke');
        }
        consentId = consent.consent_id;
        // Re-issue after revoke: domain issueConsent creates revision 1 for a fresh aggregate;
        // for revoked history we append via domainIssueConsent on empty-like path is wrong.
        // Use narrow is also wrong. Re-open by issuing a new active revision through domain:
        // Domain has no "reopen"; Phase 5: allow re-issue only when last revision is revoked
        // by creating a new revision number continuation via issue on a synthetic empty consent
        // then manually — simplest correct path: domain issue on fresh ids only works for new consents.
        // For revoked consent re-grant: treat as new revision chain continuation:
        domain = reopenConsent(client, consentId, revisions, personId, input, now);
      }
      const revision = latestRevision(domain);
      await insertRevisionRow(client, revision);
      if (domain.consentId !== consentId) {
        /* unreachable */
      }
      // Ensure consents.status active on re-issue
      await client.query(
        `UPDATE consents SET status = 'active', updated_at = now() WHERE consent_id = $1`,
        [consentId],
      );

      const membership = await loadMembership(client, personId, input.granteeProfessionalId);
      const grants = compileAccessGrants({
        consentRevision: revision,
        membership:
          membership === null
            ? null
            : {
                membershipId: membership.membership_id as never,
                relationship: 'care_team_member',
                status: 'active',
              },
        grantIdFactory,
      });
      await upsertActiveGrants(
        client,
        grants,
        'care_team_member',
        membership?.membership_id ?? null,
      );
      const auditId = crypto.randomUUID();
      await insertConsentAudit(client, {
        action: 'consent_issued',
        resourceType: 'consent_revision',
        resourceId: revision.revisionId,
        personId,
        actorPrincipalType: 'person',
        actorPrincipalId: personId,
        purpose: input.scope.purposes.join(','),
        accessDecision: 'allow',
        metadata: {
          granteeProfessionalId: input.granteeProfessionalId,
          categories: input.scope.categories,
          purposes: input.scope.purposes,
          grantCount: grants.length,
          auditId,
        },
      });
      deps.onAudit?.({
        action: 'consent_issued',
        resourceType: 'consent_revision',
        resourceId: revision.revisionId,
        personId,
        actorPrincipalType: 'person',
        actorPrincipalId: personId,
        purpose: input.scope.purposes.join(','),
        accessDecision: 'allow',
        metadata: { granteeProfessionalId: input.granteeProfessionalId },
      });
      return {
        consentId,
        revisionId: revision.revisionId,
        grantCount: grants.length,
      };
    });
  } catch (error) {
    throw toConsentError(error);
  }
}

/**
 * Re-open a revoked consent by appending a new active revision with continued numbering.
 * Domain issueConsent always starts at revision 1 on a new aggregate — we rebuild history.
 */
function reopenConsent(
  _client: PoolClient,
  consentId: string,
  revisions: RevisionRow[],
  personId: string,
  input: {
    granteeProfessionalId: string;
    scope: ConsentScopeInput;
    effectiveFrom?: number;
    effectiveUntil?: number | null;
  },
  now: number,
): Consent {
  const history: ConsentRevision[] = revisions.map((r) => ({
    revisionId: r.consent_revision_id as never,
    consentId: r.consent_id as never,
    revisionNumber: r.revision_number,
    personId: r.person_id as never,
    granteeProfessionalId: r.grantee_professional_id as never,
    scope: {
      categories: r.categories as AccessCategory[],
      purposes: r.purposes as AccessPurpose[],
    },
    status: r.status as ConsentRevision['status'],
    window: {
      effectiveFrom: toMs(r.effective_from),
      effectiveUntil: r.effective_until === null ? null : toMs(r.effective_until),
    },
    issuedAt: toMs(r.issued_at),
    issuedByPersonId: r.issued_by_person_id as never,
    supersedesRevisionId: r.supersedes_revision_id as never,
  }));
  const priorNumber = history.reduce((max, r) => Math.max(max, r.revisionNumber), 0);
  const priorLast = history[history.length - 1];
  const nextNumber = priorNumber + 1;
  const supersedes = priorLast?.revisionId ?? (null as never);
  const reopenedRevision: ConsentRevision = {
    revisionId: crypto.randomUUID() as never,
    consentId: consentId as never,
    revisionNumber: nextNumber,
    personId: personId as never,
    granteeProfessionalId: input.granteeProfessionalId as never,
    scope: {
      categories: [...input.scope.categories],
      purposes: [...input.scope.purposes],
    },
    status: 'active',
    window: {
      effectiveFrom: input.effectiveFrom ?? now,
      effectiveUntil: input.effectiveUntil ?? null,
    },
    issuedAt: now,
    issuedByPersonId: personId as never,
    supersedesRevisionId: supersedes,
  };
  return {
    consentId: consentId as never,
    personId: personId as never,
    granteeProfessionalId: input.granteeProfessionalId as never,
    status: 'active',
    revisions: [...history, reopenedRevision],
  };
}

/** Person revokes consent; all compiled grants for the pair are revoked in-tx (I-9). */
export async function revokePersonConsent(
  deps: ConsentDeps,
  actor: ConsentActor,
  input: { readonly granteeProfessionalId: string },
): Promise<{ revisionId: string; revokedGrants: number }> {
  const personId = requirePersonActor(actor);
  try {
    return await runInSystemContext(deps.pool, 'consent:revoke', async (client) => {
      const now = Date.now();
      const { consent, revisions } = await loadConsentRows(
        client,
        personId,
        input.granteeProfessionalId,
      );
      if (consent === null) {
        throw new ConsentError('not_found', 'Consent not found');
      }
      const domain = toDomainConsent(consent, revisions);
      const next = domainRevokeConsent({
        consent: domain,
        revisionId: crypto.randomUUID() as never,
        revokedAt: now,
        revokedByPersonId: personId as never,
      });
      const revision = latestRevision(next);
      await insertRevisionRow(client, revision);
      await client.query(
        `UPDATE consents SET status = 'revoked', updated_at = now() WHERE consent_id = $1`,
        [consent.consent_id],
      );
      const revokedGrants = await revokeActiveGrantsForPair(
        client,
        personId,
        input.granteeProfessionalId,
        now,
      );
      await insertConsentAudit(client, {
        action: 'consent_revoked',
        resourceType: 'consent',
        resourceId: consent.consent_id,
        personId,
        actorPrincipalType: 'person',
        actorPrincipalId: personId,
        purpose: null,
        accessDecision: 'deny',
        metadata: {
          granteeProfessionalId: input.granteeProfessionalId,
          revokedGrants,
          revisionId: revision.revisionId,
        },
      });
      deps.onAudit?.({
        action: 'consent_revoked',
        resourceType: 'consent',
        resourceId: consent.consent_id,
        personId,
        actorPrincipalType: 'person',
        actorPrincipalId: personId,
        purpose: null,
        accessDecision: 'deny',
        metadata: { revokedGrants },
      });
      return { revisionId: revision.revisionId, revokedGrants };
    });
  } catch (error) {
    throw toConsentError(error);
  }
}

/** Person narrows consent scope; out-of-scope grants revoked, survivors re-pointed. */
export async function narrowPersonConsent(
  deps: ConsentDeps,
  actor: ConsentActor,
  input: {
    readonly granteeProfessionalId: string;
    readonly scope: ConsentScopeInput;
  },
): Promise<{ revisionId: string; grantCount: number }> {
  const personId = requirePersonActor(actor);
  try {
    return await runInSystemContext(deps.pool, 'consent:narrow', async (client) => {
      const now = Date.now();
      const { consent, revisions } = await loadConsentRows(
        client,
        personId,
        input.granteeProfessionalId,
      );
      if (consent === null) {
        throw new ConsentError('not_found', 'Consent not found');
      }
      const domain = toDomainConsent(consent, revisions);
      const next = domainNarrowConsentScope({
        consent: domain,
        revisionId: crypto.randomUUID() as never,
        nextScope: input.scope,
        at: now,
        personId: personId as never,
      });
      const revision = latestRevision(next);
      await insertRevisionRow(client, revision);

      await revokeGrantsOutsideScope(
        client,
        personId,
        input.granteeProfessionalId,
        revision.scope.categories,
        revision.scope.purposes,
        now,
      );

      const membership = await loadMembership(client, personId, input.granteeProfessionalId);
      const grants = compileAccessGrants({
        consentRevision: revision,
        membership:
          membership === null
            ? null
            : {
                membershipId: membership.membership_id as never,
                relationship: 'care_team_member',
                status: 'active',
              },
        grantIdFactory,
      });
      await upsertActiveGrants(
        client,
        grants,
        'care_team_member',
        membership?.membership_id ?? null,
      );
      await insertConsentAudit(client, {
        action: 'consent_narrowed',
        resourceType: 'consent_revision',
        resourceId: revision.revisionId,
        personId,
        actorPrincipalType: 'person',
        actorPrincipalId: personId,
        purpose: revision.scope.purposes.join(','),
        accessDecision: 'allow',
        metadata: {
          categories: revision.scope.categories,
          purposes: revision.scope.purposes,
          grantCount: grants.length,
        },
      });
      deps.onAudit?.({
        action: 'consent_narrowed',
        resourceType: 'consent_revision',
        resourceId: revision.revisionId,
        personId,
        actorPrincipalType: 'person',
        actorPrincipalId: personId,
        purpose: revision.scope.purposes.join(','),
        accessDecision: 'allow',
        metadata: { grantCount: grants.length },
      });
      return { revisionId: revision.revisionId, grantCount: grants.length };
    });
  } catch (error) {
    throw toConsentError(error);
  }
}

/** Professional files a proposal — no health power while pending. */
export async function createPersonAccessRequest(
  deps: ConsentDeps,
  actor: ConsentActor,
  input: {
    readonly personId: string;
    readonly scope: ConsentScopeInput;
  },
): Promise<{ accessRequestId: string }> {
  const professionalId = requireProfessionalActor(actor);
  try {
    return await runInSystemContext(deps.pool, 'consent:request_create', async (client) => {
      const now = Date.now();
      const request = domainCreateAccessRequest({
        accessRequestId: crypto.randomUUID() as never,
        personId: input.personId as never,
        requesterProfessionalId: professionalId as never,
        scope: input.scope,
        createdAt: now,
      });
      const res = await client.query<{ access_request_id: string }>(
        `INSERT INTO access_requests (
           access_request_id, person_id, requester_professional_id,
           categories, purposes, status, created_at
         ) VALUES ($1, $2, $3, $4::text[], $5::text[], 'pending', to_timestamp($6 / 1000.0))
         RETURNING access_request_id`,
        [
          request.accessRequestId,
          request.personId,
          request.requesterProfessionalId,
          request.categories,
          request.purposes,
          request.createdAt,
        ],
      );
      const id = res.rows[0]?.access_request_id ?? request.accessRequestId;
      await insertConsentAudit(client, {
        action: 'access_request_created',
        resourceType: 'access_request',
        resourceId: id,
        personId: input.personId,
        actorPrincipalType: 'professional',
        actorPrincipalId: professionalId,
        purpose: request.purposes.join(','),
        accessDecision: 'deny',
        metadata: {
          categories: request.categories,
          purposes: request.purposes,
          pending: true,
        },
      });
      deps.onAudit?.({
        action: 'access_request_created',
        resourceType: 'access_request',
        resourceId: id,
        personId: input.personId,
        actorPrincipalType: 'professional',
        actorPrincipalId: professionalId,
        purpose: request.purposes.join(','),
        accessDecision: 'deny',
        metadata: { pending: true },
      });
      return { accessRequestId: id };
    });
  } catch (error) {
    throw toConsentError(error);
  }
}

interface AccessRequestRow {
  access_request_id: string;
  person_id: string;
  requester_professional_id: string;
  categories: string[];
  purposes: string[];
  status: string;
  created_at: Date;
  resolved_at: Date | null;
}

/**
 * Person accepts/rejects; withdraw by requester. Accept with no active consent
 * materializes consent + compiled grants in the same transaction (proposal → consent).
 * Still no direct power from the request row itself.
 */
export async function resolvePersonAccessRequest(
  deps: ConsentDeps,
  actor: ConsentActor,
  input: {
    readonly accessRequestId: string;
    readonly decision: 'accept' | 'reject' | 'withdraw';
  },
): Promise<{ status: string; consentIssued: boolean }> {
  try {
    return await runInSystemContext(deps.pool, 'consent:request_resolve', async (client) => {
      const now = Date.now();
      const found = await client.query<AccessRequestRow>(
        `SELECT access_request_id, person_id, requester_professional_id,
                categories, purposes, status, created_at, resolved_at
         FROM access_requests
         WHERE access_request_id = $1
         FOR UPDATE`,
        [input.accessRequestId],
      );
      const row = found.rows[0];
      if (row === undefined) {
        throw new ConsentError('not_found', 'Access request not found');
      }
      const base = domainCreateAccessRequest({
        accessRequestId: row.access_request_id as never,
        personId: row.person_id as never,
        requesterProfessionalId: row.requester_professional_id as never,
        scope: {
          categories: row.categories as AccessCategory[],
          purposes: row.purposes as AccessPurpose[],
        },
        createdAt: toMs(row.created_at),
      });
      // Overlay persisted status transitions by replaying from pending via domain ops
      // when status already terminal, fail closed.
      let status = base.status;
      if (row.status !== 'pending') {
        throw new ConsentError('invalid_state', 'Access request already resolved');
      }

      let actorPrincipalType: 'person' | 'professional' = 'person';
      let actorPrincipalId: string;
      let consentIssued = false;

      if (input.decision === 'withdraw') {
        actorPrincipalType = 'professional';
        actorPrincipalId = requireProfessionalActor(actor);
        const next = domainWithdrawAccessRequest({
          request: base,
          requesterProfessionalId: actorPrincipalId as never,
          at: now,
        });
        status = next.status;
      } else {
        actorPrincipalId = requirePersonActor(actor);
        if (input.decision === 'accept') {
          const next = domainAcceptAccessRequest({
            request: base,
            personId: actorPrincipalId as never,
            at: now,
          });
          status = next.status;
          // Materialize consent only if no active consent for this grantee yet.
          const existing = await client.query<{ status: string }>(
            `SELECT status FROM consents
             WHERE person_id = $1 AND grantee_professional_id = $2
             FOR UPDATE`,
            [row.person_id, row.requester_professional_id],
          );
          const consentStatus = existing.rows[0]?.status;
          if (consentStatus !== 'active') {
            await issueConsentInTx(client, {
              personId: row.person_id,
              granteeProfessionalId: row.requester_professional_id,
              categories: row.categories as AccessCategory[],
              purposes: row.purposes as AccessPurpose[],
              at: now,
            });
            consentIssued = true;
          }
        } else {
          const next = domainRejectAccessRequest({
            request: base,
            personId: actorPrincipalId as never,
            at: now,
          });
          status = next.status;
        }
      }

      await client.query(
        `UPDATE access_requests
         SET status = $2, resolved_at = to_timestamp($3 / 1000.0)
         WHERE access_request_id = $1 AND status = 'pending'`,
        [row.access_request_id, status, now],
      );
      if (status !== 'accepted' && status !== 'rejected' && status !== 'withdrawn') {
        throw new ConsentError('invalid_state', 'Access request transition failed');
      }

      await insertConsentAudit(client, {
        action: `access_request_${status}`,
        resourceType: 'access_request',
        resourceId: row.access_request_id,
        personId: row.person_id,
        actorPrincipalType,
        actorPrincipalId,
        purpose: row.purposes.join(','),
        accessDecision: status === 'accepted' ? 'allow' : 'deny',
        metadata: {
          decision: input.decision,
          consentIssued,
        },
      });
      deps.onAudit?.({
        action: `access_request_${status}`,
        resourceType: 'access_request',
        resourceId: row.access_request_id,
        personId: row.person_id,
        actorPrincipalType,
        actorPrincipalId,
        purpose: row.purposes.join(','),
        accessDecision: status === 'accepted' ? 'allow' : 'deny',
        metadata: { decision: input.decision, consentIssued },
      });
      return { status, consentIssued };
    });
  } catch (error) {
    throw toConsentError(error);
  }
}

async function issueConsentInTx(
  client: PoolClient,
  input: {
    personId: string;
    granteeProfessionalId: string;
    categories: AccessCategory[];
    purposes: AccessPurpose[];
    at: number;
  },
): Promise<void> {
  const consentId = await ensureConsentRow(client, input.personId, input.granteeProfessionalId);
  const { consent, revisions } = await loadConsentRows(
    client,
    input.personId,
    input.granteeProfessionalId,
  );
  if (consent === null) {
    throw new ConsentError('conflict', 'Unable to create consent');
  }
  let revision: ConsentRevision;
  if (revisions.length === 0 || !revisions.some((r) => r.status === 'active')) {
    const domain =
      revisions.length === 0
        ? domainIssueConsent({
            consentId: consentId as never,
            revisionId: crypto.randomUUID() as never,
            personId: input.personId as never,
            granteeProfessionalId: input.granteeProfessionalId as never,
            scope: { categories: input.categories, purposes: input.purposes },
            window: { effectiveFrom: input.at, effectiveUntil: null },
            issuedAt: input.at,
          })
        : reopenConsent(
            client,
            consentId,
            revisions,
            input.personId,
            {
              granteeProfessionalId: input.granteeProfessionalId,
              scope: { categories: input.categories, purposes: input.purposes },
              effectiveFrom: input.at,
              effectiveUntil: null,
            },
            input.at,
          );
    revision = latestRevision(domain);
    await insertRevisionRow(client, revision);
    await client.query(
      `UPDATE consents SET status = 'active', updated_at = now() WHERE consent_id = $1`,
      [consentId],
    );
  } else {
    // Active consent exists with different scope — do not auto-expand; leave as-is.
    return;
  }
  const membership = await loadMembership(client, input.personId, input.granteeProfessionalId);
  const grants = compileAccessGrants({
    consentRevision: revision,
    membership:
      membership === null
        ? null
        : {
            membershipId: membership.membership_id as never,
            relationship: 'care_team_member',
            status: 'active',
          },
    grantIdFactory,
  });
  await upsertActiveGrants(client, grants, 'care_team_member', membership?.membership_id ?? null);
}

/** Exported for tests: pure revoke helper re-export. */
export { revokeAccessGrant, SYSTEM_PRINCIPAL_ID };
