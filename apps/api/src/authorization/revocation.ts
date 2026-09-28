/**
 * Revocation propagation (I-9): consent revoke / membership end → deny next request.
 * Mechanism: synchronous grant UPDATE in the same service call; no async cache.
 * Next authorizeHealthAccess / RLS query reads committed rows (staleness ≈ commit time).
 * Contract SLA: ≤ 5 seconds (measured in integration tests).
 */
import { revokePersonConsent } from '../consent/index.js';
import type { ConsentActor } from '../consent/index.js';
import { revokeGrantsForMembership } from './compiler.js';
import type { AuthorizationDeps } from './types.js';

export const REVOCATION_SLA_MS = 5_000;

export async function revokeConsentWithPropagation(
  deps: AuthorizationDeps,
  actor: ConsentActor,
  input: { readonly granteeProfessionalId: string },
): Promise<{ revisionId: string; revokedGrants: number; propagatedAtMs: number }> {
  const started = Date.now();
  const result = await revokePersonConsent(deps, actor, input);
  const propagatedAtMs = Date.now() - started;
  return { ...result, propagatedAtMs };
}

export async function endMembershipWithGrantRevocation(
  deps: AuthorizationDeps,
  input: { readonly membershipId: string; readonly personId?: string | null },
): Promise<{ membershipId: string; grantsRevoked: number }> {
  const count = await revokeGrantsForMembership(deps, input);
  return { membershipId: input.membershipId, grantsRevoked: count };
}

/**
 * Measure end-to-end: authorized request succeeds → revoke → subsequent request denied.
 * Returns elapsed milliseconds from revoke completion to observed deny (must be ≤ SLA).
 */
export async function measureRevocationLatency(
  revoke: () => Promise<unknown>,
  probeUntilDenied: () => Promise<{ allowed: boolean }>,
): Promise<{ denied: boolean; elapsedMs: number; withinSla: boolean }> {
  await revoke();
  const t0 = Date.now();
  const probe = await probeUntilDenied();
  const elapsedMs = Date.now() - t0;
  return {
    denied: !probe.allowed,
    elapsedMs,
    withinSla: elapsedMs <= REVOCATION_SLA_MS,
  };
}
