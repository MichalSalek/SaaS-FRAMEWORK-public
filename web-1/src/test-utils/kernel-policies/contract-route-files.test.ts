/**
 * File route <-> contract: Next routes by FILE, the contract declares the path, and both
 * must name the same endpoint. A file may bind several contracts when they share that path
 * (`bindEndpoint` + `defineEndpointSwitch`, salon staff). Every contract key is bound once.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_CONTRACT_LIST } from '@kernel/application/contracts/api-contracts.registry';

const V1 = fileURLToPath(new URL('../../pages/api/v1', import.meta.url));
const boundKeys = (source: string): string[] =>
  [
    ...source.matchAll(
      /(?:defineEndpoint|bindEndpoint)\(\s*[A-Z][A-Z0-9_]*_CONTRACTS\.([A-Z][A-Z0-9_]*)\b/g
    ),
  ].map(match => match[1] ?? '');

const routeFile = (path: string): string | null =>
  [join(V1, path, 'index.ts'), join(V1, `${path}.ts`)].find(f =>
    existsSync(f)
  ) ?? null;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    return statSync(full).isDirectory()
      ? walk(full)
      : full.endsWith('.ts') && !full.endsWith('.test.ts')
        ? [full]
        : [];
  });

const filePath = (file: string): string =>
  relative(V1, file)
    .replace(/\\/g, '/')
    .replace(/\/index\.ts$/, '')
    .replace(/\.ts$/, '');

describe('contract route files', () => {
  it('has contracts to check (presence floor)', () => {
    expect(API_CONTRACT_LIST.length).toBeGreaterThanOrEqual(8);
  });

  it.each(API_CONTRACT_LIST.map(c => [c.key, c.path] as const))(
    '%s lives in pages/api/v1/%s and binds its own contract',
    (key, path) => {
      const file = routeFile(path);
      expect(file, `missing route file for ${path}`).not.toBeNull();
      const keys = boundKeys(readFileSync(file ?? '', 'utf8'));
      expect(keys).toContain(key);
    }
  );

  it('every defineEndpoint or bindEndpoint binds the contract of its own path', () => {
    const byKey = new Map(API_CONTRACT_LIST.map(c => [c.key, c.path]));
    const bindings = walk(V1).flatMap(file =>
      boundKeys(readFileSync(file, 'utf8')).map(key => ({ file, key }))
    );
    expect(bindings.length).toBe(API_CONTRACT_LIST.length);
    expect(new Set(bindings.map(binding => binding.key)).size).toBe(
      bindings.length
    );
    for (const { file, key } of bindings) {
      expect(byKey.get(key), filePath(file)).toBe(filePath(file));
    }
  });
});
