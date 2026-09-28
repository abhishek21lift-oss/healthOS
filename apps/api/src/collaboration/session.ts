/**
 * Resolve collaboration actor from Phase 3 session — server-side only.
 */
import { resolveSession, type AuthDeps, type AuthenticatedPrincipal } from '@health-os/auth';

import { actorFromPrincipal, CollaborationError, type CollaborationActor } from './types.js';

export async function requireCollaborationActor(
  deps: AuthDeps,
  sessionToken: string,
): Promise<CollaborationActor> {
  const principal: AuthenticatedPrincipal | null = await resolveSession(deps, { sessionToken });
  if (principal === null) {
    throw new CollaborationError('forbidden', 'Authentication required');
  }
  try {
    return actorFromPrincipal(principal);
  } catch (error) {
    throw new CollaborationError('forbidden', 'Authentication required', { cause: error });
  }
}
