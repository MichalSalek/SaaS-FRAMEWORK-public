// Registry contract of the root guard rules (node:test twin of the workspace Vitest suites): every
// discovered rule is switched on, has a presence floor and ships a RuleTester suite.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GUARDS, guardConfigs } from './index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('nf guard registry (root)', () => {
  it('discovers at least one rule', () => {
    assert.ok(GUARDS.length > 0);
  });

  for (const guard of GUARDS) {
    describe(`nf/${guard.name}`, () => {
      it('has at least one config block with a files root', () => {
        assert.ok(guard.blocks.length > 0);
        for (const block of guard.blocks) {
          assert.ok(block.files.length > 0);
        }
        assert.ok(guardConfigs.some(block => `nf/${guard.name}` in block.rules));
      });
      it('has a presence floor', () => {
        assert.ok(guard.presence.minSites > 0);
        assert.ok(guard.presence.what.length > 0);
      });
      it('ships a RuleTester suite', () => {
        assert.ok(existsSync(path.join(HERE, 'rules', `${guard.name}.test.mjs`)));
      });
      it('names only paths that exist', () => {
        for (const rel of guard.paths ?? []) {
          assert.ok(existsSync(path.join(HERE, '..', rel)), rel);
        }
      });
    });
  }
});
