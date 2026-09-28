/**
 * Observations service — Phase 6.
 * Category: timeline_read (create + read); RLS uses the same category.
 */
import {
  createObservation as domainCreateObservation,
  observationId,
  type Observation,
} from '@health-os/domain';

import { authorizeClinical, runClinicalAsPrincipal } from './pep.js';
import { queueTimelineProjection } from '../timeline/outbox.js';
import {
  ClinicalError,
  requireProfessional,
  toClinicalError,
  type ClinicalActor,
  type ClinicalDeps,
} from './types.js';

function wrapDomain<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw toClinicalError(error);
  }
}

export interface CreateObservationInput {
  readonly personId: string;
  readonly code: string;
  readonly valueNumeric?: number | null;
  readonly valueText?: string | null;
  readonly unit?: string | null;
  readonly observedAt?: number;
  readonly purpose: string;
  readonly requestId?: string;
}

export async function createObservation(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  input: CreateObservationInput,
): Promise<Observation> {
  const professionalId = requireProfessional(actor);
  await authorizeClinical(deps, actor, {
    personId: input.personId,
    category: 'timeline_read',
    purpose: input.purpose,
    action: 'create',
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  });

  const now = Date.now();
  const domain = wrapDomain(() =>
    domainCreateObservation({
      observationId: observationId(crypto.randomUUID()),
      personId: input.personId as never,
      code: input.code,
      valueNumeric: input.valueNumeric ?? null,
      valueText: input.valueText ?? null,
      unit: input.unit ?? null,
      observedAt: input.observedAt ?? now,
      recordedByProfessionalId: professionalId as never,
      createdAt: now,
    }),
  );

  return runClinicalAsPrincipal(
    deps,
    actor,
    {
      purpose: input.purpose,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    },
    async (client) => {
      const res = await client.query<{ observation_id: string }>(
        `INSERT INTO observations (
           observation_id, person_id, code, value_numeric, value_text, unit,
           observed_at, recorded_by_professional_id, data_class
         ) VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), $8, $9)
         RETURNING observation_id`,
        [
          domain.observationId,
          domain.personId,
          domain.code,
          domain.valueNumeric,
          domain.valueText,
          domain.unit,
          domain.observedAt,
          domain.recordedByProfessionalId,
          domain.dataClass,
        ],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ClinicalError('denied', 'RLS rejected observation insert');
      }
      await queueTimelineProjection(client, {
        personId: domain.personId,
        sourceType: 'observation',
        sourceId: domain.observationId,
      });
      return domain;
    },
  );
}

export interface ListObservationsInput {
  readonly personId: string;
  readonly purpose: string;
  readonly limit?: number;
  readonly requestId?: string;
}

export async function listObservations(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  input: ListObservationsInput,
): Promise<readonly Record<string, unknown>[]> {
  await authorizeClinical(deps, actor, {
    personId: input.personId,
    category: 'timeline_read',
    purpose: input.purpose,
    action: 'read',
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  });
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const { rows } = await runClinicalAsPrincipal(
    deps,
    actor,
    {
      purpose: input.purpose,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    },
    (client) =>
      client.query<{
        observation_id: string;
        person_id: string;
        code: string;
        value_numeric: number | null;
        value_text: string | null;
        unit: string | null;
        observed_at: Date;
        data_class: string;
      }>(
        `SELECT observation_id, person_id, code, value_numeric, value_text, unit,
                observed_at, data_class
         FROM observations
         WHERE person_id = $1
         ORDER BY observed_at DESC
         LIMIT $2`,
        [input.personId, limit],
      ),
  );
  return rows;
}
