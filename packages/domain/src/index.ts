/**
 * packages/domain — pure domain kernel for Health Collaboration OS.
 *
 * Contract: docs/architecture/CONTRACT-v0.2.md (FROZEN).
 * Forbidden: database, HTTP, filesystem, env, frameworks, AI SDKs, node builtins.
 */
export const DOMAIN_CONTRACT_VERSION = '0.2' as const;

export type DomainBrand<TBrand extends string, TValue> = TValue & {
  readonly __brand: TBrand;
};

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}

export * from './errors.js';

export * from './ids.js';

export * from './primitives.js';

export * from './actors.js';

export * from './access.js';

export * from './access-request.js';

export * from './consent.js';

export * from './assessment.js';

export * from './care.js';

export * from './handoff.js';

export * from './invitation.js';

export * from './collaboration.js';

export * from './private-note.js';

export * from './timeline.js';

export * from './document.js';

export * from './observation.js';
