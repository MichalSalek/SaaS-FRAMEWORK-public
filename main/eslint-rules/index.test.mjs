// Registry contract of the local guard rules: every discovered rule is switched on somewhere, has a
// presence floor and ships a RuleTester suite. Without this, a rule file could exist, look like
// protection, and never run.
// @vitest-environment node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GUARDS, guardConfigs } from './index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('nf guard registry', () => {
  it('discovers at least one rule', () => {
    expect(GUARDS.length).toBeGreaterThan(0);
  });

  for (const guard of GUARDS) {
    describe(`nf/${guard.name}`, () => {
      it('has at least one config block with a files root', () => {
        expect(guard.blocks.length).toBeGreaterThan(0);
        for (const block of guard.blocks) {
          expect(block.files.length).toBeGreaterThan(0);
        }
        expect(guardConfigs.some(block => `nf/${guard.name}` in block.rules)).toBe(true);
      });

      it('has a presence floor', () => {
        expect(guard.presence.minSites).toBeGreaterThan(0);
        expect(guard.presence.what.length).toBeGreaterThan(0);
      });

      it('ships a RuleTester suite', () => {
        expect(
          existsSync(path.join(HERE, 'rules', `${guard.name}.test.mjs`))
        ).toBe(true);
      });

      it('names only paths that exist', () => {
        for (const rel of guard.paths ?? []) {
          expect(existsSync(path.join(HERE, '..', rel)), rel).toBe(true);
        }
      });
    });
  }
});
