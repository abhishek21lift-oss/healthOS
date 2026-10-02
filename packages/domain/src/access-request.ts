import { DomainError, invalidTransition } from './errors.js';
import type { AccessRequestId, PersonId, ProfessionalId } from './ids.js';
import type { AccessCategory, AccessPurpose } from './primitives.js';

function requirePending(request: AccessRequest, to: AccessRequestStatus): void {
  if (request.status !== 'pending') {
    throw invalidTransition(
      'AccessRequest',
      'INVALID_ACCESS_REQUEST_TRANSITION',
      request.status,
      to,
    );
  }
}

export type AccessRequestStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn';

export interface AccessRequest {
  readonly accessRequestId: AccessRequestId;
  readonly personId: PersonId;
  readonly requesterProfessionalId: ProfessionalId;
  readonly categories: readonly AccessCategory[];
  readonly purposes: readonly AccessPurpose[];
  readonly status: AccessRequestStatus;
  readonly createdAt: number;
  readonly resolvedAt: number | null;
}

export interface AccessRequestScope {
  readonly categories: readonly AccessCategory[];
  readonly purposes: readonly AccessPurpose[];
}

/**
 * Contract line: AccessRequest = proposal that can become consent
 * (no power while pending). A pending or resolved request never confers
 * health access; only an active ConsentRevision + compiled AccessGrant does.
 */
export function accessRequestHasHealthPower(_request: AccessRequest): false {
  return false;
}

export function createAccessRequest(input: {
  accessRequestId: AccessRequestId;
  personId: PersonId;
  requesterProfessionalId: ProfessionalId;
  scope: AccessRequestScope;
  createdAt: number;
}): AccessRequest {
  if (input.scope.categories.length === 0 || input.scope.purposes.length === 0) {
    throw new DomainError(
      'INVALID_DOMAIN_VALUE',
      'AccessRequest requires categories and purposes',
      {
        entity: 'AccessRequest',
        reason: 'empty_scope',
      },
    );
  }
  return {
    accessRequestId: input.accessRequestId,
    personId: input.personId,
    requesterProfessionalId: input.requesterProfessionalId,
    categories: [...input.scope.categories],
    purposes: [...input.scope.purposes],
    status: 'pending',
    createdAt: input.createdAt,
    resolvedAt: null,
  };
}

/** Person accepts → proposal may become consent (still no direct health power). */
export function acceptAccessRequest(input: {
  request: AccessRequest;
  personId: PersonId;
  at: number;
}): AccessRequest {
  requirePending(input.request, 'accepted');
  if (input.personId !== input.request.personId) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'Only the person may accept an access request', {
      entity: 'AccessRequest',
      reason: 'not_person_grantor',
    });
  }
  if (input.at < input.request.createdAt) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'resolvedAt before createdAt', {
      entity: 'AccessRequest',
      reason: 'time_order',
    });
  }
  return {
    ...input.request,
    status: 'accepted',
    resolvedAt: input.at,
  };
}

export function rejectAccessRequest(input: {
  request: AccessRequest;
  personId: PersonId;
  at: number;
}): AccessRequest {
  requirePending(input.request, 'rejected');
  if (input.personId !== input.request.personId) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'Only the person may reject an access request', {
      entity: 'AccessRequest',
      reason: 'not_person_grantor',
    });
  }
  return {
    ...input.request,
    status: 'rejected',
    resolvedAt: input.at,
  };
}

export function withdrawAccessRequest(input: {
  request: AccessRequest;
  requesterProfessionalId: ProfessionalId;
  at: number;
}): AccessRequest {
  requirePending(input.request, 'withdrawn');
  if (input.requesterProfessionalId !== input.request.requesterProfessionalId) {
    throw new DomainError(
      'INVALID_DOMAIN_VALUE',
      'Only the requester may withdraw an access request',
      {
        entity: 'AccessRequest',
        reason: 'not_requester',
      },
    );
  }
  return {
    ...input.request,
    status: 'withdrawn',
    resolvedAt: input.at,
  };
}
