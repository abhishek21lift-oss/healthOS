import { DOMAIN_CONTRACT_VERSION } from '@health-os/domain';
import { VALIDATION_TARGET_CONTRACT } from '@health-os/validation';

export const DATABASE_READY = true as const;

export const DATABASE_CONTRACT_VERSION = DOMAIN_CONTRACT_VERSION;

export const DATABASE_VALIDATION_VERSION = VALIDATION_TARGET_CONTRACT;

export * from './pool.js';

export * from './migrate.js';

export * from './mappers.js';

export * from './fixture.js';
