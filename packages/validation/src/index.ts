import { DOMAIN_CONTRACT_VERSION } from '@health-os/domain';

export type ValidationOutcome<T> =
  | {
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly ok: false;
      readonly issues: readonly string[];
    };

export function ok<T>(value: T): ValidationOutcome<T> {
  return { ok: true, value };
}

export function fail(issues: readonly string[]): ValidationOutcome<never> {
  return { ok: false, issues };
}

/** Ensures the validation package retains its domain dependency edge for boundary tests. */
export const VALIDATION_TARGET_CONTRACT: '0.2' = DOMAIN_CONTRACT_VERSION;
