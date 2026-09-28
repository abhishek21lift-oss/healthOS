import { describe, expect, it } from 'vitest';

import { workerShellStatus } from './main.js';

describe('worker shell', () => {
  it('does not drain outbox or run AI jobs in Phase 0', () => {
    const status = workerShellStatus();
    expect(status.phase).toBe(0);
    expect(status.outboxDrainEnabled).toBe(false);
    expect(status.aiJobsEnabled).toBe(false);
  });
});
