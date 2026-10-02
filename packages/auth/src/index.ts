import { DOMAIN_CONTRACT_VERSION } from '@health-os/domain';
import { VALIDATION_TARGET_CONTRACT } from '@health-os/validation';

export const AUTH_READY: true = true;

export const AUTH_CONTRACT_VERSION: '0.2' = DOMAIN_CONTRACT_VERSION;

export const AUTH_VALIDATION_VERSION: '0.2' = VALIDATION_TARGET_CONTRACT;

export * from './contact.js';

export * from './password.js';

export * from './tokens.js';

export * from './age.js';

export * from './rate-limit.js';

export * from './cookies.js';

export * from './csrf.js';

export * from './security-events.js';

export * from './session-policy.js';

export * from './services.js';
