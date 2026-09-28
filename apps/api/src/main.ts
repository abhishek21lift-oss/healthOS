/**
 * apps/api — API composition shell (modular monolith, ADR-0009).
 * Phase 2: database package ready; still no HTTP framework, routes, CORS, or health endpoints.
 * Later phases compose domain + permissions + auth at this edge only.
 */
import { AUTH_READY } from '@health-os/auth';
import { DATABASE_READY } from '@health-os/database';
import { DOMAIN_CONTRACT_VERSION } from '@health-os/domain';
import { evaluateAccess } from '@health-os/permissions';
import { VALIDATION_TARGET_CONTRACT } from '@health-os/validation';

export interface ApiShellStatus {
  readonly phase: 3;
  readonly contractVersion: string;
  readonly databaseReady: boolean;
  readonly authReady: boolean;
  readonly httpListening: boolean;
}

export function apiShellStatus(): ApiShellStatus {
  return {
    phase: 3,
    contractVersion: DOMAIN_CONTRACT_VERSION,
    databaseReady: DATABASE_READY,
    authReady: AUTH_READY,
    httpListening: false,
  };
}

export { evaluateAccess, VALIDATION_TARGET_CONTRACT };

export function main(): void {
  const status = apiShellStatus();
  const listening = status.httpListening ? 'true' : 'false';
  console.warn(
    `Health Collaboration OS API shell (Phase ${String(status.phase)}). contract=${status.contractVersion} listening=${listening}`,
  );
}
