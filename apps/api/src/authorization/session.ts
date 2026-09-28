/**
 * Resolve authorization actor from Phase 3 session — server-side only.
 */
import { resolveSession, type AuthDeps, type AuthenticatedPrincipal } from '@health-os/auth';

import { actorFromPrincipal, AuthorizationError, type AuthorizationActor } from './types.js';

export async function requireAuthorizationActor(
  deps: AuthDeps,
  sessionToken: string,
): Promise<AuthorizationActor> {
  const principal: AuthenticatedPrincipal | null = await resolveSession(deps, { sessionToken });
  if (principal === null) {
    throw new AuthorizationError('forbidden', 'Authentication required');
  }
  try {
    return actorFromPrincipal(principal);
  } catch (error) {
    throw new AuthorizationError('forbidden', 'Authentication required', { cause: error });
  }
}
