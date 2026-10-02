import { DomainError } from './errors.js';
import { requireNonEmpty } from './primitives.js';
import type { ObservationId, PersonId, ProfessionalId } from './ids.js';
import type { DataClass } from './primitives.js';

export interface Observation {
  readonly observationId: ObservationId;
  readonly personId: PersonId;
  readonly code: string;
  readonly valueNumeric: number | null;
  readonly valueText: string | null;
  readonly unit: string | null;
  readonly observedAt: number;
  readonly recordedByProfessionalId: ProfessionalId | null;
  readonly dataClass: DataClass;
  readonly createdAt: number;
}

export function createObservation(input: {
  observationId: ObservationId;
  personId: PersonId;
  code: string;
  valueNumeric?: number | null;
  valueText?: string | null;
  unit?: string | null;
  observedAt: number;
  recordedByProfessionalId?: ProfessionalId | null;
  dataClass?: DataClass;
  createdAt: number;
}): Observation {
  const valueNumeric = input.valueNumeric ?? null;
  const valueText = input.valueText ?? null;
  if (valueNumeric === null && (valueText === null || valueText.trim().length === 0)) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'Observation requires a value', {
      entity: 'Observation',
      reason: 'no_value',
    });
  }
  if (valueNumeric !== null && valueText !== null) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'Observation cannot set numeric and text', {
      entity: 'Observation',
      reason: 'both_values',
    });
  }
  return {
    observationId: input.observationId,
    personId: input.personId,
    code: requireNonEmpty('Observation', 'code', input.code),
    valueNumeric,
    valueText,
    unit: input.unit ?? null,
    observedAt: input.observedAt,
    recordedByProfessionalId: input.recordedByProfessionalId ?? null,
    dataClass: input.dataClass ?? 'SHARED_HEALTH',
    createdAt: input.createdAt,
  };
}
