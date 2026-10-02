/**
 * CSRF protection for cookie-based auth (synchronizer token bound to session).
 * SameSite alone is not sufficient (phase requirement).
 */

import { CSRF_HEADER_NAME } from './cookies.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type CsrfFailureReason = 'missing' | 'invalid' | 'cross_origin' | 'method_not_required';

export type CsrfResult =
  | {
      readonly ok: true;
    }
  | {
      readonly ok: false;
      readonly reason: CsrfFailureReason;
    };

export function isStateChangingMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

export function validateCsrf(input: {
  readonly method: string;
  readonly sessionCsrfToken: string | null;
  readonly headerToken: string | undefined;
  readonly originHeader?: string | undefined;
  readonly allowedOrigins: readonly string[];
}): CsrfResult {
  if (!isStateChangingMethod(input.method)) {
    return { ok: true };
  }
  if (input.sessionCsrfToken === null || input.sessionCsrfToken.length === 0) {
    return { ok: false, reason: 'missing' };
  }
  const header = input.headerToken;
  if (header === undefined || header.length === 0) {
    return { ok: false, reason: 'missing' };
  }
  if (header !== input.sessionCsrfToken) {
    return { ok: false, reason: 'invalid' };
  }
  const origin = input.originHeader;
  if (origin !== undefined && origin.length > 0) {
    if (!input.allowedOrigins.includes(origin)) {
      return { ok: false, reason: 'cross_origin' };
    }
  }
  return { ok: true };
}

export { CSRF_HEADER_NAME };
