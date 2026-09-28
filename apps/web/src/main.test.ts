import { describe, expect, it } from 'vitest';

import { webShellStatus } from './main.js';

describe('web shell', () => {
  it('has no database access', () => {
    const status = webShellStatus();
    expect(status.databaseAccess).toBe(false);
    expect(status.phase).toBe(0);
  });
});
