// @vitest-environment node
// Registry contract of the CSS guard rules: every rule has roots, a floor and its own test suite.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CSS_RULES } from './index.mjs';
import { matchesAny } from './engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('css guard registry', () => {
  it('discovers rules', () => {
    expect(CSS_RULES.length).toBeGreaterThan(0);
  });
  it('glob matcher handles ** and braces', () => {
    expect(matchesAny('src/UI/a/b.module.css', ['src/**/*.css'])).toBe(true);
    expect(matchesAny('src/a.css', ['src/**/*.css'])).toBe(true);
    expect(matchesAny('src/a.tsx', ['src/**/*.{css,scss}'])).toBe(false);
  });
  for (const rule of CSS_RULES) {
    describe(`css/${rule.name}`, () => {
      it('has roots, a floor and a test suite', () => {
        expect(rule.files.length).toBeGreaterThan(0);
        expect(rule.presence.minSites).toBeGreaterThan(0);
        expect(existsSync(path.join(HERE, 'rules', `${rule.name}.test.mjs`))).toBe(true);
      });
      it('names only paths that exist', () => {
        for (const rel of rule.paths ?? []) {
          expect(existsSync(path.join(HERE, '..', rel)), rel).toBe(true);
        }
      });
    });
  }
});
