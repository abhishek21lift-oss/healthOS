/**
 * Phase-0 / contract freeze tests (B3).
 *
 * docs/architecture/CONTRACT-v0.2.md freezes the domain contract and forbids
 * database/HTTP/framework/AI imports in packages. These tests assert the
 * frozen contract is intact.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { DOMAIN_CONTRACT_VERSION } from '@health-os/domain';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function* walkTs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walkTs(full);
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) yield full;
  }
}

describe('domain kernel contract', () => {
  it('exposes the frozen contract version', () => {
    expect(DOMAIN_CONTRACT_VERSION).toBe('0.2');
  });

  it('packages/domain has no runtime dependencies (purity)', () => {
    const pkg = JSON.parse(
      readFileSync(path.join(root, 'packages/domain/package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });

  it('the frozen contract document still exists', () => {
    expect(existsSync(path.join(root, 'docs/architecture/CONTRACT-v0.2.md'))).toBe(true);
  });

  it('domain source does not touch process.env, fs, child_process, or fetch', () => {
    const forbidden = [/process\.env/, /child_process/, /\bfetch\(/, /XMLHttpRequest/, /require\(/];
    for (const file of walkTs(path.join(root, 'packages/domain/src'))) {
      const src = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        const match = src.match(pattern);
        expect(match, `${file} must not reference ${pattern.source}`).toBeNull();
      }
    }
  });
});
