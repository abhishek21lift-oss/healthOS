/**
 * apps/api/src/clinical — Phase 6 clinical core, private notes, documents.
 *
 * Every operation: Phase 5 PEP (evaluateAuthorization) → PostgreSQL RLS.
 * No independent authorization engines in this module (contract).
 */
export * from './types.js';
export * from './pep.js';
export * from './observations.js';
export * from './assessments.js';
export * from './care.js';
export * from './private-notes.js';
export * from './documents.js';
