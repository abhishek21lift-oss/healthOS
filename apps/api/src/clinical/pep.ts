/**
 * Phase 6 clinical PEP + dual-gate helpers.
 * Flow: validate purpose → authorizeHealthAccess (Phase 5) → SQL under principal RLS.
 * Never bypass RLS; app deny short-circuits before SQL.
 */
import {
  beginRequest,
  clearRequest,
  runInPrincipalContext,
  type PoolClient,
} from '@health-os/database';
import type { AuthorizationAction } from '@health-os/permissions';

import { authorizeHealthAccess, AuthorizationError } from '../authorization/index.js';
import { ClinicalError, requirePurpose, type ClinicalActor, type ClinicalDeps } from './types.js';

export interface ClinicalAuthInput {
  readonly personId: string;
  readonly category: string;
  readonly purpose: string;
  readonly action?: AuthorizationAction;
  readonly requestId?: string;
}

export async function authorizeClinical(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  input: ClinicalAuthInput,
): Promise<void> {
  const purpose = requirePurpose(input.purpose);
  try {
    const result = await authorizeHealthAccess(deps, actor, {
      personId: input.personId,
      category: input.category,
      purpose,
      ...(input.action !== undefined ? { action: input.action } : {}),
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    });
    if (!result.decision.allowed) {
      throw new ClinicalError('denied', 'Access denied', {
        denyReason: result.decision.reason,
      });
    }
  } catch (error) {
    if (error instanceof ClinicalError) {
      throw error;
    }
    if (error instanceof AuthorizationError) {
      throw new ClinicalError(
        error.code === 'not_found' ? 'not_found' : 'denied',
        error.externalMessage,
        error.denyReason !== undefined ? { denyReason: error.denyReason } : { cause: error },
      );
    }
    throw error;
  }
}

function principalContext(
  actor: ClinicalActor,
  purpose: string,
  requestId?: string,
): {
  principalType: 'person' | 'professional';
  principalId: string;
  purpose: string;
  requestId?: string;
} {
  if (actor.professionalId !== null) {
    return {
      principalType: 'professional',
      principalId: actor.professionalId,
      purpose,
      ...(requestId !== undefined ? { requestId } : {}),
    };
  }
  if (actor.personId !== null) {
    return {
      principalType: 'person',
      principalId: actor.personId,
      purpose,
      ...(requestId !== undefined ? { requestId } : {}),
    };
  }
  throw new ClinicalError('forbidden', 'Authenticated principal required');
}

/** Read/write health rows under principal + purpose RLS after PEP ALLOW. */
export async function runClinicalAsPrincipal<T>(
  deps: Pick<ClinicalDeps, 'pool'>,
  actor: ClinicalActor,
  input: { purpose: string; requestId?: string },
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const purpose = requirePurpose(input.purpose);
  const ctx = principalContext(actor, purpose, input.requestId);
  return runInPrincipalContext(deps.pool, ctx, fn);
}

/** Direct principal context on an existing client (caller owns BEGIN/COMMIT). */
export async function beginClinicalContext(
  client: PoolClient,
  actor: ClinicalActor,
  input: { purpose: string; requestId?: string },
): Promise<void> {
  const purpose = requirePurpose(input.purpose);
  const ctx = principalContext(actor, purpose, input.requestId);
  await beginRequest(client, ctx);
}

export async function endClinicalContext(client: PoolClient): Promise<void> {
  await clearRequest(client);
}
