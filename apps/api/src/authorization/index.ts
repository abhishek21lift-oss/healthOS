/**
 * apps/api/src/authorization — Phase 5 PEP, AccessGrant compiler,
 * AccessRequest orchestration, revocation, access summary.
 *
 * Relationship ≠ health access. Person is sole consent authority (I-2).
 * Application PEP is semantic source; PostgreSQL RLS is independent second gate.
 *
 * Consent mutations (issue / narrow / revoke / resolve) live in `apps/api/src/consent`
 * (tested service layer) and are re-exported here for a single Phase 5 entry point.
 */
export * from './types.js';
export * from './session.js';
export * from '../consent/index.js';
export * from './compiler.js';
export * from './authorize.js';
export * from './summary.js';
export * from './revocation.js';
