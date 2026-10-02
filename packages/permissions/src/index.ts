/**
 * packages/permissions — central Policy Enforcement Point (ADR-0007).
 *
 * Fixed pipeline (fail-closed):
 *   1 Authentication → 2 RBAC → 3 Relationship (membership)
 *   → 4 Consent/AccessGrant (category × purpose × window)
 *   → 5 ABAC/context (AI purpose binding, private-note author, data class)
 *   → AccessGrant dereference for audit basis.
 *
 * Phase 5: stable deny-reason taxonomy + AuthorizationContext for the health PEP.
 * Must NOT depend on database implementation, web, API framework, or AI providers.
 * Database RLS is an independent second gate (ADR-0008).
 */

import {
  DOMAIN_CONTRACT_VERSION,
  evaluateCompiledGrant,
  isKnownAccessCategory,
  isKnownAccessPurpose,
} from '@health-os/domain';
import type { AccessCategory, AccessGrant, AccessPurpose, DataClass } from '@health-os/domain';

function isRecord(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}
function deny(reason: DenyReason): Decision {
  return { allowed: false, reason };
}
function denyAuth(reason: AuthorizationDenyReason): AuthorizationDecision {
  return { allowed: false, reason };
}

export type DenyReason =
  | 'unauthenticated'
  | 'no_membership'
  | 'no_consent'
  | 'purpose_missing'
  | 'category_not_granted'
  | 'role_not_permitted'
  | 'unknown_task';

/** Phase 5 stable internal denial reasons (machine-readable; not for free-text UI). */
export type AuthorizationDenyReason =
  | 'NO_AUTHENTICATED_PRINCIPAL'
  | 'NO_RELATIONSHIP'
  | 'MEMBERSHIP_ENDED'
  | 'NO_ACTIVE_CONSENT'
  | 'CONSENT_REVOKED'
  | 'PURPOSE_REQUIRED'
  | 'PURPOSE_NOT_CONSENTED'
  | 'CATEGORY_NOT_CONSENTED'
  | 'NO_EFFECTIVE_GRANT'
  | 'GRANT_EXPIRED'
  | 'GRANT_REVOKED'
  | 'PERSON_MISMATCH'
  | 'CROSS_ORGANIZATION'
  | 'PRIVATE_NOTE'
  | 'AI_CONTEXT_NOT_CONSENTED'
  | 'ROLE_NOT_PERMITTED'
  | 'UNKNOWN_CATEGORY'
  | 'UNKNOWN_PURPOSE'
  | 'GRANT_PERSON_MISMATCH'
  | 'GRANT_GRANTEE_MISMATCH'
  | 'GRANT_CATEGORY_MISMATCH'
  | 'GRANT_PURPOSE_MISMATCH';

export type AuthorizationAction =
  'read' | 'create' | 'update' | 'amend' | 'sign' | 'share' | 'handoff' | 'ai_context';

export const AUTHORIZATION_ACTIONS: readonly AuthorizationAction[] = [
  'read',
  'create',
  'update',
  'amend',
  'sign',
  'share',
  'handoff',
  'ai_context',
];

export function isAuthorizationAction(value: string): value is AuthorizationAction {
  return (AUTHORIZATION_ACTIONS as readonly string[]).includes(value);
}

export interface PolicyPrincipal {
  readonly type: 'person' | 'professional' | 'system';
  readonly id: string;
}

/**
 * Fully specified health-access request. Callers must declare purpose on
 * every request (contract access formula). `unknown` inputs stay fail-closed
 * for backward-compatible shell tests.
 */
export interface AccessEvaluationRequest {
  readonly principal: PolicyPrincipal | null;
  readonly personId: string;
  readonly category: AccessCategory;
  readonly purpose: AccessPurpose;
  /** RBAC: principal role/type allows this action (from role registry / caller). */
  readonly roleAllows: boolean;
  /** Active CareTeamMembership (or person self). */
  readonly membershipActive: boolean;
  /** Compiled AccessGrant (null ⇒ no consent artifact). */
  readonly grant: AccessGrant | null;
  /** Active ConsentRevision covering grantee/category/purpose/time. */
  readonly consentActive: boolean;
  readonly at: number;
  /** Optional ABAC: resource data class for private/high-sensitivity checks. */
  readonly resourceDataClass?: DataClass;
  /** For private_note_read: author professional id on the resource. */
  readonly authorProfessionalId?: string | null;
}

/**
 * Server-derived authorization context (Phase 5).
 * Clients must never construct this — the service loads it from session + DB + policy inputs.
 */
export interface AuthorizationContext {
  readonly principal: PolicyPrincipal | null;
  readonly personId: string;
  readonly action: AuthorizationAction;
  readonly purpose: AccessPurpose | null;
  readonly category: string | null;
  readonly relationshipActive: boolean;
  readonly membershipActive: boolean;
  readonly consentActive: boolean;
  readonly grant: AccessGrant | null;
  readonly at: number;
  readonly authorProfessionalId?: string | null;
  readonly organizationAdmin?: boolean;
}

export type Decision =
  | {
      readonly allowed: true;
      readonly basis: 'access-grant';
      readonly grantId: string;
    }
  | {
      readonly allowed: false;
      readonly reason: DenyReason;
    };

export type AuthorizationDecision =
  | {
      readonly allowed: true;
      readonly basis: 'access-grant';
      readonly grantId: string;
      readonly consentRevisionId: string;
      readonly personId: string;
      readonly granteeProfessionalId: string;
      readonly category: AccessCategory;
      readonly purpose: AccessPurpose;
    }
  | {
      readonly allowed: false;
      readonly reason: AuthorizationDenyReason;
    };

/**
 * Layered evaluation. Order matters for audit-stable deny reasons.
 * Person self-reads are allowed when principal is the data subject (no grant needed);
 * professionals require full chain per ADR-0006.
 */
export function evaluateHealthAccess(request: AccessEvaluationRequest): Decision {
  // 1. Authentication
  if (request.principal === null) {
    return deny('unauthenticated');
  }
  const { principal } = request;
  // Person is sole health-data authority for their own rows (D2) — no RBAC/grant chain.
  if (principal.type === 'person') {
    if (principal.id !== request.personId) {
      return deny('no_membership');
    }
    // Private notes are author-only professionals (I-4); persons never read them.
    if (request.category === 'private_note_read') {
      return deny('category_not_granted');
    }
    return { allowed: true, basis: 'access-grant', grantId: 'self' };
  }
  if (principal.type !== 'professional') {
    // system break-glass / internal tools go through RLS break_glass path, not here by default
    return deny('role_not_permitted');
  }
  // 2. RBAC
  if (!request.roleAllows) {
    return deny('role_not_permitted');
  }
  // 3. Relationship — active CareTeamMembership (necessary, not sufficient)
  if (!request.membershipActive) {
    return deny('no_membership');
  }
  // Purpose must be declared on the request (contract formula / I-19)
  if (request.purpose.length === 0) {
    return deny('purpose_missing');
  }
  // 4. Consent + compiled AccessGrant
  if (request.grant === null) {
    return deny('no_consent');
  }
  if (!request.consentActive) {
    return deny('no_consent');
  }
  if (request.grant.category !== request.category) {
    return deny('category_not_granted');
  }
  if (request.grant.purpose !== request.purpose) {
    return deny('purpose_missing');
  }
  const grantCheck = evaluateCompiledGrant({
    grant: request.grant,
    membershipActive: request.membershipActive,
    consentActive: request.consentActive,
    at: request.at,
  });
  if (!grantCheck.allowed) {
    if (grantCheck.reason === 'grant_not_active' || grantCheck.reason === 'consent_inactive') {
      return deny('no_consent');
    }
    if (grantCheck.reason === 'membership_inactive') {
      return deny('no_membership');
    }
    return deny('purpose_missing');
  }
  // 5. ABAC / context
  // I-18: AI requires purpose ai_assistance and category ai_context
  if (request.category === 'ai_context' && request.purpose !== 'ai_assistance') {
    return deny('purpose_missing');
  }
  if (request.purpose === 'ai_assistance' && request.category !== 'ai_context') {
    return deny('category_not_granted');
  }
  // I-4: private notes author-only (professional path)
  if (request.category === 'private_note_read') {
    if (
      request.authorProfessionalId === null ||
      request.authorProfessionalId === undefined ||
      request.authorProfessionalId !== principal.id
    ) {
      return deny('category_not_granted');
    }
  }
  return { allowed: true, basis: 'access-grant', grantId: request.grant.grantId };
}

/**
 * Fail-closed entry point. Accepts a fully specified AccessEvaluationRequest,
 * or legacy/unknown payloads (denied with stable reasons).
 */
export function evaluateAccess(request: unknown): Decision {
  if (request === null || request === undefined) {
    return deny('unauthenticated');
  }
  if (!isRecord(request)) {
    return deny('purpose_missing');
  }
  const candidate = request;
  const complete =
    'principal' in candidate &&
    'personId' in candidate &&
    'category' in candidate &&
    'purpose' in candidate &&
    'roleAllows' in candidate &&
    'membershipActive' in candidate &&
    'consentActive' in candidate &&
    'at' in candidate &&
    'grant' in candidate;
  if (!complete) {
    return deny('purpose_missing');
  }
  return evaluateHealthAccess(candidate as AccessEvaluationRequest);
}

/**
 * Phase 5 authorization engine over a server-derived AuthorizationContext.
 * Fail-closed: missing purpose/category, unknown enums, inactive layers all deny.
 * Org role is never an input predicate for ALLOW (I-3) — organizationAdmin only
 * participates in deny-side reason stability if ever needed.
 */
export function evaluateAuthorization(context: AuthorizationContext): AuthorizationDecision {
  if (context.principal === null) {
    return denyAuth('NO_AUTHENTICATED_PRINCIPAL');
  }
  const { principal } = context;
  if (principal.type === 'person') {
    if (principal.id !== context.personId) {
      return denyAuth('PERSON_MISMATCH');
    }
    if (context.category === 'private_note_read') {
      return denyAuth('PRIVATE_NOTE');
    }
    if (context.purpose === null || context.purpose.length === 0) {
      return denyAuth('PURPOSE_REQUIRED');
    }
    if (context.category === null) {
      return denyAuth('UNKNOWN_CATEGORY');
    }
    if (!isKnownAccessCategory(context.category)) {
      return denyAuth('UNKNOWN_CATEGORY');
    }
    if (!isKnownAccessPurpose(context.purpose)) {
      return denyAuth('UNKNOWN_PURPOSE');
    }
    // Person self path: no grant required for own non-private health rows.
    return {
      allowed: true,
      basis: 'access-grant',
      grantId: 'self',
      consentRevisionId: 'self',
      personId: context.personId,
      granteeProfessionalId: principal.id,
      category: context.category,
      purpose: context.purpose,
    };
  }
  if (principal.type !== 'professional') {
    return denyAuth('ROLE_NOT_PERMITTED');
  }
  if (context.purpose === null || context.purpose.length === 0) {
    return denyAuth('PURPOSE_REQUIRED');
  }
  if (!isKnownAccessPurpose(context.purpose)) {
    return denyAuth('UNKNOWN_PURPOSE');
  }
  if (context.category === null || context.category.length === 0) {
    return denyAuth('UNKNOWN_CATEGORY');
  }
  if (!isKnownAccessCategory(context.category)) {
    return denyAuth('UNKNOWN_CATEGORY');
  }
  const category = context.category;
  const purpose = context.purpose;
  // I-4: private notes are structural author-only class — never via ordinary AccessGrant.
  if (category === 'private_note_read') {
    return denyAuth('PRIVATE_NOTE');
  }
  // Relationship layer (membership necessary, not sufficient)
  if (!context.relationshipActive && !context.membershipActive) {
    return denyAuth('NO_RELATIONSHIP');
  }
  if (!context.membershipActive && context.relationshipActive) {
    // Relationship without open membership still insufficient for grant chain.
    return denyAuth('MEMBERSHIP_ENDED');
  }
  if (!context.membershipActive) {
    return denyAuth('MEMBERSHIP_ENDED');
  }
  if (!context.consentActive) {
    return denyAuth('NO_ACTIVE_CONSENT');
  }
  if (context.grant === null) {
    return denyAuth('NO_EFFECTIVE_GRANT');
  }
  const grant = context.grant;
  if (grant.personId !== context.personId) {
    return denyAuth('GRANT_PERSON_MISMATCH');
  }
  if (grant.granteeProfessionalId !== principal.id) {
    return denyAuth('GRANT_GRANTEE_MISMATCH');
  }
  if (grant.status === 'revoked') {
    return denyAuth('GRANT_REVOKED');
  }
  if (grant.status === 'expired') {
    return denyAuth('GRANT_EXPIRED');
  }
  if (grant.category !== category) {
    return denyAuth('GRANT_CATEGORY_MISMATCH');
  }
  if (grant.purpose !== purpose) {
    return denyAuth('GRANT_PURPOSE_MISMATCH');
  }
  // I-18 AI binding
  if (category === 'ai_context' && purpose !== 'ai_assistance') {
    return denyAuth('AI_CONTEXT_NOT_CONSENTED');
  }
  if (purpose === 'ai_assistance' && category !== 'ai_context') {
    return denyAuth('AI_CONTEXT_NOT_CONSENTED');
  }
  const grantCheck = evaluateCompiledGrant({
    grant,
    membershipActive: context.membershipActive,
    consentActive: context.consentActive,
    at: context.at,
  });
  if (!grantCheck.allowed) {
    if (grantCheck.reason === 'grant_not_active') {
      return denyAuth('GRANT_REVOKED');
    }
    if (grantCheck.reason === 'window_inactive') {
      return denyAuth('GRANT_EXPIRED');
    }
    if (grantCheck.reason === 'membership_inactive') {
      return denyAuth('MEMBERSHIP_ENDED');
    }
    return denyAuth('NO_ACTIVE_CONSENT');
  }
  // Category-specific consent coverage is encoded on the grant (compiler ⊆ consent).
  return {
    allowed: true,
    basis: 'access-grant',
    grantId: grant.grantId,
    consentRevisionId: grant.consentRevisionId,
    personId: grant.personId,
    granteeProfessionalId: grant.granteeProfessionalId,
    category: grant.category,
    purpose: grant.purpose,
  };
}

/**
 * Fail-closed entry for unknown/malformed authorization payloads.
 */
export function evaluateAuthorizationRequest(request: unknown): AuthorizationDecision {
  if (request === null || request === undefined || !isRecord(request)) {
    return denyAuth('NO_AUTHENTICATED_PRINCIPAL');
  }
  const candidate = request;
  const complete =
    'principal' in candidate &&
    'personId' in candidate &&
    'action' in candidate &&
    'purpose' in candidate &&
    'category' in candidate &&
    'relationshipActive' in candidate &&
    'membershipActive' in candidate &&
    'consentActive' in candidate &&
    'grant' in candidate &&
    'at' in candidate;
  if (!complete) {
    return denyAuth('PURPOSE_REQUIRED');
  }
  if (typeof candidate.action !== 'string' || !isAuthorizationAction(candidate.action)) {
    return denyAuth('ROLE_NOT_PERMITTED');
  }
  return evaluateAuthorization(candidate as AuthorizationContext);
}

export const PERMISSIONS_CONTRACT_VERSION: '0.2' = DOMAIN_CONTRACT_VERSION;
