/**
 * Access decision primitives (domain facts only — not the full PEP).
 * Full layered authorization lives in packages/permissions (later phases).
 */

import { windowActive } from './primitives.js';
import type {
  AccessGrantId,
  CareTeamMembershipId,
  ConsentId,
  ConsentRevisionId,
  PersonId,
  ProfessionalId,
} from './ids.js';
import type { AccessCategory, AccessPurpose, RelationshipClass, TimeWindow } from './primitives.js';
import type { ConsentRevision, ConsentScope } from './consent.js';

/** Categories that must never appear on an ordinary compiled health grant (I-4). */
const ORDINARY_GRANT_FORBIDDEN_CATEGORIES = new Set(['private_note_read']);

export type AccessGrantStatus = 'active' | 'revoked' | 'expired';

/**
 * Compiled allow artifact (contract): always recomputable from consent + membership.
 * Phase 1 stores the basis chain; evaluation of full pipeline is Phase 5.
 */
export interface AccessGrant {
  readonly grantId: AccessGrantId;
  readonly personId: PersonId;
  readonly granteeProfessionalId: ProfessionalId;
  readonly category: AccessCategory;
  readonly purpose: AccessPurpose;
  readonly status: AccessGrantStatus;
  readonly relationship: RelationshipClass;
  readonly membershipId: CareTeamMembershipId;
  readonly consentRevisionId: ConsentRevisionId;
  readonly window: TimeWindow;
  readonly issuedAt: number;
}

export interface AccessDecisionInput {
  readonly grant: AccessGrant;
  readonly membershipActive: boolean;
  readonly consentActive: boolean;
  readonly at: number;
}

export type AccessDecision =
  | {
      readonly allowed: true;
      readonly grantId: AccessGrantId;
    }
  | {
      readonly allowed: false;
      readonly reason:
        'grant_not_active' | 'membership_inactive' | 'consent_inactive' | 'window_inactive';
    };

/**
 * Minimal domain-level check of compiled grant facts.
 * Fail-closed: every missing or inactive layer denies.
 */
export function evaluateCompiledGrant(input: AccessDecisionInput): AccessDecision {
  const { grant } = input;
  if (grant.status !== 'active') {
    return { allowed: false, reason: 'grant_not_active' };
  }
  if (!input.membershipActive) {
    return { allowed: false, reason: 'membership_inactive' };
  }
  if (!input.consentActive) {
    return { allowed: false, reason: 'consent_inactive' };
  }
  if (!windowActive(grant.window, input.at)) {
    return { allowed: false, reason: 'window_inactive' };
  }
  return { allowed: true, grantId: grant.grantId };
}

export function revokeAccessGrant(grant: AccessGrant, at: number): AccessGrant {
  if (grant.status === 'revoked') {
    return grant;
  }
  return {
    ...grant,
    status: 'revoked',
    window: { effectiveFrom: grant.window.effectiveFrom, effectiveUntil: at },
  };
}

export function expireAccessGrant(grant: AccessGrant, at: number): AccessGrant {
  if (grant.status !== 'active') {
    return grant;
  }
  return {
    ...grant,
    status: 'expired',
    window: { effectiveFrom: grant.window.effectiveFrom, effectiveUntil: at },
  };
}

/** One (category × purpose) pair from a consent scope. */
export interface GrantCandidate {
  readonly category: AccessCategory;
  readonly purpose: AccessPurpose;
}

export interface MembershipBasis {
  readonly membershipId: CareTeamMembershipId;
  readonly relationship: RelationshipClass;
  readonly status: 'active' | 'inactive' | 'ended';
}

export interface CompileGrantsInput {
  readonly consentRevision: ConsentRevision;
  readonly membership: MembershipBasis | null;
  readonly grantIdFactory: (category: AccessCategory, purpose: AccessPurpose) => AccessGrantId;
}

/**
 * ADR-0006: AccessGrant is always recomputable from consent + membership.
 * Cartesian product of scope categories × purposes; no membership ⇒ no grants
 * (consent without membership ⇒ deny, contract access formula).
 * Pending AccessRequests never feed this compiler (no power while pending).
 * Never emits private_note_read — private notes are author-only (I-4), not consent-granted.
 */
export function compileAccessGrants(input: CompileGrantsInput): AccessGrant[] {
  const { consentRevision, membership } = input;
  if (consentRevision.status !== 'active') {
    return [];
  }
  if (membership?.status !== 'active') {
    return [];
  }
  const grants: AccessGrant[] = [];
  for (const category of consentRevision.scope.categories) {
    if (ORDINARY_GRANT_FORBIDDEN_CATEGORIES.has(category)) {
      continue;
    }
    for (const purpose of consentRevision.scope.purposes) {
      grants.push({
        grantId: input.grantIdFactory(category, purpose),
        personId: consentRevision.personId,
        granteeProfessionalId: consentRevision.granteeProfessionalId,
        category,
        purpose,
        status: 'active',
        relationship: membership.relationship,
        membershipId: membership.membershipId,
        consentRevisionId: consentRevision.revisionId,
        window: {
          effectiveFrom: consentRevision.window.effectiveFrom,
          effectiveUntil: consentRevision.window.effectiveUntil,
        },
        issuedAt: consentRevision.issuedAt,
      });
    }
  }
  return grants;
}

/** Pairs that remain covered after a scope narrowing (intersection with prior active grants). */
export function scopeGrantCandidates(scope: ConsentScope): GrantCandidate[] {
  const out = [];
  for (const category of scope.categories) {
    for (const purpose of scope.purposes) {
      out.push({ category, purpose });
    }
  }
  return out;
}

export function candidateKey(candidate: GrantCandidate): string {
  return `${candidate.category}::${candidate.purpose}`;
}

/**
 * Revoke every grant tied to a consent revision (person revoke fan-out).
 * Idempotent: already-revoked grants are returned unchanged.
 */
export function revokeGrantsForConsent(
  grants: readonly AccessGrant[],
  consentId: ConsentId,
  revisions: readonly ConsentRevision[],
  at: number,
): AccessGrant[] {
  const revisionIds = new Set(
    revisions.filter((r) => r.consentId === consentId).map((r) => r.revisionId),
  );
  return grants.map((g) =>
    revisionIds.has(g.consentRevisionId) && g.status === 'active' ? revokeAccessGrant(g, at) : g,
  );
}

/**
 * Align compiled grants to a (possibly narrowed) active revision:
 * - revoke active grants not in the new candidate set (or stale revision id)
 * - activate/refresh grants that are in the set
 * Unrelated grants (other consent revisions) are left untouched by the caller filter.
 */
export function reconcileGrantsToRevision(
  grants: readonly AccessGrant[],
  consentRevision: ConsentRevision,
  membership: MembershipBasis | null,
  at: number,
  grantIdFactory: (category: AccessCategory, purpose: AccessPurpose) => AccessGrantId,
): {
  keep: AccessGrant[];
  upsert: AccessGrant[];
  revoke: AccessGrant[];
} {
  if (consentRevision.status !== 'active') {
    const revoke = grants.filter((g) => g.status === 'active').map((g) => revokeAccessGrant(g, at));
    return { keep: [], upsert: [], revoke };
  }
  const desired = new Set(
    compileAccessGrants({
      consentRevision,
      membership,
      grantIdFactory,
    }).map((g) => candidateKey(g)),
  );
  const keep: AccessGrant[] = [];
  const revoke: AccessGrant[] = [];
  for (const g of grants) {
    if (g.status !== 'active') {
      continue;
    }
    if (desired.has(candidateKey(g)) && g.consentRevisionId === consentRevision.revisionId) {
      keep.push(g);
    } else if (desired.has(candidateKey(g))) {
      // Same pair, superseding revision: treat as upsert target (caller replaces).
      revoke.push(revokeAccessGrant(g, at));
    } else {
      revoke.push(revokeAccessGrant(g, at));
    }
  }
  const upsert = compileAccessGrants({ consentRevision, membership, grantIdFactory }).filter(
    (g) =>
      !keep.some(
        (k) =>
          k.category === g.category &&
          k.purpose === g.purpose &&
          k.consentRevisionId === g.consentRevisionId,
      ),
  );
  return { keep, upsert, revoke };
}
