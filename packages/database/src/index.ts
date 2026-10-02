import { DOMAIN_CONTRACT_VERSION } from '@health-os/domain';
import { VALIDATION_TARGET_CONTRACT } from '@health-os/validation';

export const DATABASE_READY: true = true;

export const DATABASE_CONTRACT_VERSION: '0.2' = DOMAIN_CONTRACT_VERSION;

export const DATABASE_VALIDATION_VERSION: '0.2' = VALIDATION_TARGET_CONTRACT;

export * from './pool.js';

export * from './migrate.js';

export * from './mappers.js';

export * from './fixture.js';
