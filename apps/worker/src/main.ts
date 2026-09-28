/**
 * apps/worker — background execution shell (ADR-0014 outbox consumers later).
 * Phase 0: no queue, no Redis, no outbox drain, no AI jobs.
 */
import { DOMAIN_CONTRACT_VERSION } from '@health-os/domain';

export interface WorkerShellStatus {
  readonly phase: 0;
  readonly contractVersion: string;
  readonly outboxDrainEnabled: boolean;
  readonly aiJobsEnabled: boolean;
}

export function workerShellStatus(): WorkerShellStatus {
  return {
    phase: 0,
    contractVersion: DOMAIN_CONTRACT_VERSION,
    outboxDrainEnabled: false,
    aiJobsEnabled: false,
  };
}

export function main(): void {
  const status = workerShellStatus();
  const outbox = status.outboxDrainEnabled ? 'true' : 'false';
  console.warn(
    `Health Collaboration OS worker shell (Phase 0). contract=${status.contractVersion} outbox=${outbox}`,
  );
}
