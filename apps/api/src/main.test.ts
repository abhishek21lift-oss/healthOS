import { describe, expect, it } from 'vitest';

import { apiShellStatus } from './main.js';

describe('api shell', () => {
  it('is Phase 3 shell: database + auth ready, no HTTP listening', () => {
    const status = apiShellStatus();
    expect(status.phase).toBe(3);
    expect(status.httpListening).toBe(false);
    expect(status.databaseReady).toBe(true);
    expect(status.authReady).toBe(true);
  });
});
