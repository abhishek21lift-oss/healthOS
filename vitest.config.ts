import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

const workspaceSrc = {
  '@health-os/domain': path.resolve(root, 'packages/domain/src/index.ts'),
  '@health-os/validation': path.resolve(root, 'packages/validation/src/index.ts'),
  '@health-os/permissions': path.resolve(root, 'packages/permissions/src/index.ts'),
  '@health-os/database': path.resolve(root, 'packages/database/src/index.ts'),
  '@health-os/auth': path.resolve(root, 'packages/auth/src/index.ts'),
  '@health-os/ui': path.resolve(root, 'packages/ui/src/index.ts'),
};

export default defineConfig({
  resolve: {
    alias: workspaceSrc,
  },
  test: {
    globals: false,
    environment: 'node',
    projects: [
      {
        resolve: { alias: workspaceSrc },
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
          exclude: [
            'packages/database/**',
            'packages/auth/src/**/*.integration.test.ts',
            'apps/api/src/**/*.integration.test.ts',
          ],
          environment: 'node',
        },
      },
      {
        resolve: { alias: workspaceSrc },
        test: {
          name: 'database',
          include: [
            'packages/database/src/**/*.test.ts',
            'packages/auth/src/**/*.integration.test.ts',
            'apps/api/src/**/*.integration.test.ts',
          ],
          environment: 'node',
          // Shared DB: serialize so fixture TRUNCATE/DELETE cannot race auth inserts.
          fileParallelism: false,
          testTimeout: 180_000,
          hookTimeout: 180_000,
        },
      },
      {
        resolve: { alias: workspaceSrc },
        test: {
          name: 'architecture',
          include: ['tests/architecture/**/*.test.ts'],
          environment: 'node',
          testTimeout: 120_000,
        },
      },
    ],
  },
});
