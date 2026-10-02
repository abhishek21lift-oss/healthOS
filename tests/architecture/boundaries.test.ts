/**
 * Boundary tests (B3): enforce the CONTRACT-v0.2.md dependency table.
 *
 * These statically inspect every import specifier in each package/app's
 * source and assert that the forbidden dependency directions described in
 * docs/architecture/CONTRACT-v0.2.md are not present.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const IMPORT_PATTERNS = [
  /(?:import|export)[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
];

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (
      entry === 'node_modules' ||
      entry === 'dist' ||
      entry === '.turbo' ||
      entry === 'coverage'
    ) {
      continue;
    }
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...tsFilesUnder(full));
      continue;
    }
    if (full.endsWith('.ts') && !full.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function specifiersUnder(relDir: string): string[] {
  const dir = path.join(root, relDir);
  const specs: string[] = [];
  for (const file of tsFilesUnder(dir)) {
    const src = readFileSync(file, 'utf8');
    for (const pattern of IMPORT_PATTERNS) {
      pattern.lastIndex = 0;
      for (const m of src.matchAll(pattern)) {
        if (m[1]) specs.push(m[1]);
      }
    }
  }
  return specs;
}

function noneMatch(specs: string[], predicate: (s: string) => boolean): boolean {
  return specs.every((s) => !predicate(s));
}

const isWorkspacePkg = (s: string) => s.startsWith('@health-os/');
const isNodeBuiltin = (s: string) => s.startsWith('node:') || /^[a-z_]+$/.test(s);

describe('domain purity (ADR-0009)', () => {
  it('packages/domain never imports anything outside its own module tree', () => {
    const specs = specifiersUnder('packages/domain/src');
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      // domain may only reference sibling modules relatively; every other
      // import (framework, db, http, AI, builtins) is forbidden.
      expect(spec.startsWith('./') || spec.startsWith('../')).toBe(true);
    }
  });
});

describe('permissions engine isolation (ADR-0007)', () => {
  it('packages/permissions does not import the database layer', () => {
    const specs = specifiersUnder('packages/permissions/src');
    expect(noneMatch(specs, (s) => s === '@health-os/database')).toBe(true);
  });

  it('packages/auth does not import the authorization engine', () => {
    const specs = specifiersUnder('packages/auth/src');
    expect(noneMatch(specs, (s) => s === '@health-os/permissions')).toBe(true);
  });
});

describe('database layer boundary', () => {
  it('packages/database does not import auth or permissions', () => {
    const specs = specifiersUnder('packages/database/src');
    expect(noneMatch(specs, (s) => s === '@health-os/auth')).toBe(true);
    expect(noneMatch(specs, (s) => s === '@health-os/permissions')).toBe(true);
  });
});

describe('validation', () => {
  it('packages/validation only depends on domain among workspace packages', () => {
    const specs = specifiersUnder('packages/validation/src');
    for (const spec of specs) {
      if (isWorkspacePkg(spec)) {
        expect(spec).toBe('@health-os/domain');
      }
    }
  });
});

describe('ui is presentation-only', () => {
  it('packages/ui never touches the database or the authz engine', () => {
    const specs = specifiersUnder('packages/ui/src');
    expect(noneMatch(specs, (s) => s === '@health-os/database')).toBe(true);
    expect(noneMatch(specs, (s) => s === '@health-os/permissions')).toBe(true);
  });
});

describe('app boundaries', () => {
  it('apps/web does not access PostgreSQL or the database package', () => {
    const specs = specifiersUnder('apps/web/src');
    expect(noneMatch(specs, (s) => s === '@health-os/database')).toBe(true);
    expect(noneMatch(specs, (s) => s === 'pg' || s.startsWith('pg/') || s === 'postgres')).toBe(
      true,
    );
  });

  it('apps never import each other directly', () => {
    for (const app of ['apps/api', 'apps/web', 'apps/worker']) {
      const specs = specifiersUnder(`${app}/src`);
      for (const spec of specs) {
        // workspace packages are the only allowed cross-app entry points.
        const otherRelativeAppImport =
          (spec.startsWith('.') || spec.startsWith('/')) &&
          /apps(\/|\\)(api|web|worker)/.test(spec);
        expect(otherRelativeAppImport).toBe(false);
        expect(['@health-os/api', '@health-os/web', '@health-os/worker']).not.toContain(spec);
      }
    }
  });
});

describe('forbidden import kinds in domain-adjacent code', () => {
  it('no workspace package outside database imports pg directly', () => {
    for (const pkg of ['domain', 'validation', 'permissions', 'ui', 'auth']) {
      const specs = specifiersUnder(`packages/${pkg}/src`);
      expect(
        noneMatch(
          specs,
          (s) => s === 'pg' || s.startsWith('pg/') || (isNodeBuiltin(s) && s.includes('sql')),
        ),
      ).toBe(true);
    }
  });
});
