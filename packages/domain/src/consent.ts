import { DomainError, invalidTransition } from './errors.js';
import { windowActive } from './primitives.js';
import type { ConsentId, ConsentRevisionId, PersonId, ProfessionalId } from './ids.js';
import type { AccessCategory, AccessPurpose, TimeWindow } from './primitives.js';

function scopeCovers(
  scope: ConsentScope,
  category: AccessCategory,
  purpose: AccessPurpose,
): boolean {
  return scope.categories.includes(category) && scope.purposes.includes(purpose);
}
function latestRevision(consent: Consent): ConsentRevision | undefined {
  return consent.revisions[consent.revisions.length - 1];
}

export type ConsentRevisionStatus = 'active' | 'revoked';

export interface ConsentScope {
  readonly categories: readonly AccessCategory[];
  readonly purposes: readonly AccessPurpose[];
}

/**
 * Immutable historical revision. Once created, never mutated.
 */
export interface ConsentRevision {
  readonly revisionId: ConsentRevisionId;
  readonly consentId: ConsentId;
  readonly revisionNumber: number;
  readonly personId: PersonId;
  readonly granteeProfessionalId: ProfessionalId;
  readonly scope: ConsentScope;
  readonly status: ConsentRevisionStatus;
  readonly window: TimeWindow;
  readonly issuedAt: number;
  readonly issuedByPersonId: PersonId;
  readonly supersedesRevisionId: ConsentRevisionId | null;
}

export type ConsentStatus = 'active' | 'revoked';

export interface Consent {
  readonly consentId: ConsentId;
  readonly personId: PersonId;
  readonly granteeProfessionalId: ProfessionalId;
  readonly revisions: readonly ConsentRevision[];
  readonly status: ConsentStatus;
}

export interface ConsentCoverageQuery {
  readonly category: AccessCategory;
  readonly purpose: AccessPurpose;
  readonly granteeProfessionalId: ProfessionalId;
  readonly at: number;
}

export type ConsentCoverageResult =
  | {
      readonly covered: true;
      readonly revisionId: ConsentRevisionId;
    }
  | {
      readonly covered: false;
      readonly reason: 'not_active' | 'not_covered' | 'window' | 'wrong_grantee';
    };

export function issueConsent(input: {
  consentId: ConsentId;
  revisionId: ConsentRevisionId;
  personId: PersonId;
  granteeProfessionalId: ProfessionalId;
  scope: ConsentScope;
  window: TimeWindow;
  issuedAt: number;
}): Consent {
  if (input.scope.categories.length === 0 || input.scope.purposes.length === 0) {
    throw new DomainError(
      'INVALID_DOMAIN_VALUE',
      'Consent scope requires categories and purposes',
      {
        entity: 'Consent',
        reason: 'empty_scope',
      },
    );
  }
  if (
    input.window.effectiveUntil !== null &&
    input.window.effectiveUntil < input.window.effectiveFrom
  ) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'Consent window end before start', {
      entity: 'Consent',
      reason: 'invalid_window',
    });
  }
  const revision: ConsentRevision = {
    revisionId: input.revisionId,
    consentId: input.consentId,
    revisionNumber: 1,
    personId: input.personId,
    granteeProfessionalId: input.granteeProfessionalId,
    scope: {
      categories: [...input.scope.categories],
      purposes: [...input.scope.purposes],
    },
    status: 'active',
    window: input.window,
    issuedAt: input.issuedAt,
    issuedByPersonId: input.personId,
    supersedesRevisionId: null,
  };
  return {
    consentId: input.consentId,
    personId: input.personId,
    granteeProfessionalId: input.granteeProfessionalId,
    revisions: [revision],
    status: 'active',
  };
}

/**
 * Explicit full revocation: appends a revoked revision; prior history remains.
 */
export function revokeConsent(input: {
  consent: Consent;
  revisionId: ConsentRevisionId;
  revokedAt: number;
  revokedByPersonId: PersonId;
}): Consent {
  const current = latestRevision(input.consent);
  if (current === undefined) {
    throw invalidTransition('Consent', 'INVALID_CONSENT_TRANSITION', 'empty', 'revoked');
  }
  if (input.revokedByPersonId !== input.consent.personId) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'Only the person may revoke consent', {
      entity: 'Consent',
      reason: 'not_person_grantor',
    });
  }
  if (input.consent.status === 'revoked') {
    throw invalidTransition(
      'Consent',
      'INVALID_CONSENT_TRANSITION',
      'revoked',
      'revoked',
      'already_revoked',
    );
  }
  if (input.revokedAt < current.issuedAt) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'revokedAt before issuedAt', {
      entity: 'Consent',
      reason: 'time_order',
    });
  }
  const revoked: ConsentRevision = {
    ...current,
    revisionId: input.revisionId,
    revisionNumber: current.revisionNumber + 1,
    status: 'revoked',
    window: {
      effectiveFrom: current.window.effectiveFrom,
      effectiveUntil: input.revokedAt,
    },
    issuedAt: input.revokedAt,
    issuedByPersonId: input.revokedByPersonId,
    supersedesRevisionId: current.revisionId,
  };
  return {
    ...input.consent,
    revisions: [...input.consent.revisions, revoked],
    status: 'revoked',
  };
}

/**
 * Partial narrowing: replace active scope with a reduced scope (new active revision).
 * Removing all categories/purposes is equivalent to full revoke via revokeConsent.
 */
export function narrowConsentScope(input: {
  consent: Consent;
  revisionId: ConsentRevisionId;
  nextScope: ConsentScope;
  at: number;
  personId: PersonId;
}): Consent {
  const current = latestRevision(input.consent);
  if (current === undefined || input.consent.status !== 'active') {
    throw invalidTransition(
      'Consent',
      'INVALID_CONSENT_TRANSITION',
      input.consent.status,
      'narrowed',
    );
  }
  if (current.status !== 'active') {
    throw invalidTransition('Consent', 'INVALID_CONSENT_TRANSITION', current.status, 'narrowed');
  }
  if (input.personId !== input.consent.personId) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'Only the person may narrow consent', {
      entity: 'Consent',
      reason: 'not_person_grantor',
    });
  }
  if (input.nextScope.categories.length === 0 || input.nextScope.purposes.length === 0) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'Use revokeConsent for empty scope', {
      entity: 'Consent',
      reason: 'empty_scope_use_revoke',
    });
  }
  const nextCategories = input.nextScope.categories.filter((c) =>
    current.scope.categories.includes(c),
  );
  const nextPurposes = input.nextScope.purposes.filter((p) => current.scope.purposes.includes(p));
  if (
    nextCategories.length === current.scope.categories.length &&
    nextPurposes.length === current.scope.purposes.length &&
    nextCategories.every((c) => input.nextScope.categories.includes(c)) &&
    nextPurposes.every((p) => input.nextScope.purposes.includes(p))
  ) {
    throw new DomainError('INVALID_CONSENT_TRANSITION', 'Next scope is not narrower', {
      entity: 'Consent',
      reason: 'scope_not_narrowed',
    });
  }
  if (nextCategories.length === 0 || nextPurposes.length === 0) {
    throw new DomainError(
      'INVALID_DOMAIN_VALUE',
      'Narrowed scope must remain non-empty; use revoke',
      {
        entity: 'Consent',
        reason: 'empty_after_narrow',
      },
    );
  }
  const narrowed: ConsentRevision = {
    ...current,
    revisionId: input.revisionId,
    revisionNumber: current.revisionNumber + 1,
    scope: { categories: nextCategories, purposes: nextPurposes },
    status: 'active',
    window: {
      effectiveFrom: current.window.effectiveFrom,
      effectiveUntil: current.window.effectiveUntil,
    },
    issuedAt: input.at,
    issuedByPersonId: input.personId,
    supersedesRevisionId: current.revisionId,
  };
  return {
    ...input.consent,
    revisions: [...input.consent.revisions, narrowed],
    status: 'active',
  };
}

export function isConsentActiveAt(consent: Consent, at: number): boolean {
  if (consent.status !== 'active') {
    return false;
  }
  const current = latestRevision(consent);
  if (current?.status !== 'active') {
    return false;
  }
  return windowActive(current.window, at);
}

export function evaluateConsentCoverage(
  consent: Consent,
  query: ConsentCoverageQuery,
): ConsentCoverageResult {
  if (consent.granteeProfessionalId !== query.granteeProfessionalId) {
    return { covered: false, reason: 'wrong_grantee' };
  }
  if (consent.status !== 'active') {
    return { covered: false, reason: 'not_active' };
  }
  const current = latestRevision(consent);
  if (current?.status !== 'active') {
    return { covered: false, reason: 'not_active' };
  }
  if (!scopeCovers(current.scope, query.category, query.purpose)) {
    return { covered: false, reason: 'not_covered' };
  }
  if (!windowActive(current.window, query.at)) {
    return { covered: false, reason: 'window' };
  }
  return { covered: true, revisionId: current.revisionId };
}

export function assertRevisionImmutable(revision: ConsentRevision): void {
  if (revision.revisionNumber < 1) {
    throw new DomainError('CONSENT_REVISION_IMMUTABLE', 'Revision number must be >= 1', {
      entity: 'ConsentRevision',
    });
  }
}

export function consentGrantorIsPerson(consent: Consent, personId: PersonId): boolean {
  return consent.personId === personId;
}
