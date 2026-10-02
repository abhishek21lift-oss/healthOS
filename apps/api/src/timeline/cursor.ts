/**
 * Opaque keyset cursor for timeline pagination.
 * Integrity-protected HMAC; scoped to person + filter shape; not a trust boundary
 * (authorization is always re-evaluated at read time).
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type { TimelineFilters } from './types.js';

export interface TimelineCursorPayload {
  readonly v: 1;
  readonly p: string;
  readonly t: string;
  readonly i: string;
  readonly f: string;
}

function defaultSecret(): Buffer {
  const fromEnv = process.env.TIMELINE_CURSOR_SECRET;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return Buffer.from(fromEnv, 'utf8');
  }
  // Dev-only fallback is forbidden outside development (fail closed in production).
  if (process.env.NODE_ENV === 'production') {
    throw new Error('TIMELINE_CURSOR_SECRET is required in production (M5)');
  }
  return Buffer.from('timeline-cursor-dev-only-secret', 'utf8');
}

export function filterShapeHash(filters: TimelineFilters): string {
  const eventTypes = [...(filters.eventTypes ?? [])].sort().join(',');
  const sourceTypes = [...(filters.sourceTypes ?? [])].sort().join(',');
  const from = filters.from === undefined ? '' : String(filters.from);
  const to = filters.to === undefined ? '' : String(filters.to);
  return createHash('sha256')
    .update(`f:v1:${eventTypes}:${sourceTypes}:${from}:${to}`)
    .digest('hex')
    .slice(0, 16);
}

function sign(body: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export function encodeCursor(
  payload: Omit<TimelineCursorPayload, 'v' | 'f'> & { filters: TimelineFilters },
  secret: Buffer = defaultSecret(),
): string {
  const body: TimelineCursorPayload = {
    v: 1,
    p: payload.p,
    t: payload.t,
    i: payload.i,
    f: filterShapeHash(payload.filters),
  };
  const json = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  const mac = sign(json, secret);
  return `${json}.${mac}`;
}

export function decodeCursor(
  cursor: string,
  expect: { personId: string; filters: TimelineFilters },
  secret: Buffer = defaultSecret(),
): { eventAt: string; entryId: string } {
  const parts = cursor.split('.');
  if (parts.length !== 2) {
    throw new Error('Invalid cursor');
  }
  const json = parts[0] ?? '';
  const mac = parts[1] ?? '';
  const expectedMac = sign(json, secret);
  const a = Buffer.from(mac, 'utf8');
  const b = Buffer.from(expectedMac, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Invalid cursor');
  }
  // Parse as untrusted input: version may be any number.
  let body: { v: unknown; p: unknown; t: unknown; i: unknown; f: unknown };
  try {
    body = JSON.parse(Buffer.from(json, 'base64url').toString('utf8')) as typeof body;
  } catch {
    throw new Error('Invalid cursor');
  }
  if (body.v !== 1) {
    throw new Error('Invalid cursor');
  }
  if (body.p !== expect.personId || typeof body.t !== 'string' || typeof body.i !== 'string') {
    throw new Error('Invalid cursor');
  }
  if (body.f !== filterShapeHash(expect.filters)) {
    throw new Error('Invalid cursor');
  }
  return { eventAt: body.t, entryId: body.i };
}
