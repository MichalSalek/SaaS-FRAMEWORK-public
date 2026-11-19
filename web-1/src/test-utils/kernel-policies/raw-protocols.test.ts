/**
 * Every raw handler is named in RAW_PROTOCOLS, and every catalogue entry is a real file that
 * does not pretend to be a JSON contract.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RAW_PROTOCOLS } from '@kernel/application/contracts/raw-protocols';

const API = fileURLToPath(new URL('../../pages/api', import.meta.url));
const WRAPPER =
  /withPublicHandler|withRawSecretHandler|lifecycleWebhookHandler/;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    return statSync(full).isDirectory()
      ? walk(full)
      : full.endsWith('.ts') && !full.endsWith('.test.ts')
        ? [full]
        : [];
  });

const rel = (file: string): string => relative(API, file).replace(/\\/g, '/');

describe('raw protocols', () => {
  it('lists every raw wrapper file', () => {
    const listed = new Set(RAW_PROTOCOLS.map(item => item.file));
    expect(listed.size).toBe(RAW_PROTOCOLS.length);
    const wrapped = walk(API)
      .map(rel)
      .filter(file => WRAPPER.test(readFileSync(join(API, file), 'utf8')));
    expect(wrapped.length).toBeGreaterThanOrEqual(8);
    for (const file of wrapped) {
      expect(listed.has(file), file).toBe(true);
    }
  });

  it.each(RAW_PROTOCOLS.map(item => [item.id, item.file] as const))(
    '%s is a real non-contract route',
    (_id, file) => {
      const full = join(API, file);
      expect(existsSync(full), file).toBe(true);
      const source = readFileSync(full, 'utf8');
      expect(source.includes('defineEndpoint(')).toBe(false);
      expect(source.includes('defineEndpointSwitch(')).toBe(false);
    }
  );

  it('every entry explains the protocol', () => {
    for (const item of RAW_PROTOCOLS) {
      expect(item.reason.length).toBeGreaterThan(40);
      expect(item.methods.length).toBeGreaterThan(0);
      expect(item.access.length).toBeGreaterThan(0);
    }
  });
});
