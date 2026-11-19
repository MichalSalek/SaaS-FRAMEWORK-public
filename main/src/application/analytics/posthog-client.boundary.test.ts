/**
 * `posthog-js` must stay out of the `_app` chunk (DECISION in
 * posthog-client.ts): only that module may load it. Anchored on the whole
 * `src` root, type-only imports allowed, comments and string contents ignored.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = resolve(__dirname, '../..');
const ALLOWED = 'application/analytics/posthog-client.ts';
const SOURCE_FILE = /\.(?:ts|tsx)$/;
const SKIPPED_DIR = new Set(['node_modules', '.next', 'out', 'dist']);

const VALUE_IMPORT =
  /\bimport\s+(?!type\b)[^;]*?\bfrom\s*(['"])posthog-js\1|\bimport\s*\(\s*(['"])posthog-js\2\s*\)|\brequire\s*\(\s*(['"])posthog-js\3\s*\)/g;

function listSources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    if (SKIPPED_DIR.has(name)) {
      return [];
    }
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return listSources(path);
    }
    return SOURCE_FILE.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Blanks comments; keeps string quotes so `from 'posthog-js'` stays matchable. */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

describe('posthog-js boundary', () => {
  const files = listSources(SRC_ROOT);

  it('scans the source tree and finds the one allowed loader', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.map(file => relative(SRC_ROOT, file))).toContain(ALLOWED);
    const loader = stripComments(readFileSync(join(SRC_ROOT, ALLOWED), 'utf8'));
    expect(loader.match(VALUE_IMPORT)?.length).toBe(1);
  });

  it('loads posthog-js nowhere else', () => {
    const offenders = files
      .map(file => relative(SRC_ROOT, file))
      .filter(file => file !== ALLOWED)
      .filter(
        file =>
          stripComments(readFileSync(join(SRC_ROOT, file), 'utf8')).match(
            VALUE_IMPORT
          ) !== null
      );
    expect(offenders).toEqual([]);
  });

  it('tells a type import from a value import', () => {
    const sample = [
      "import type { PostHog } from 'posthog-js';",
      "// import posthog from 'posthog-js';",
      "import posthog from 'posthog-js';",
    ].join('\n');
    expect(stripComments(sample).match(VALUE_IMPORT)?.length).toBe(1);
  });
});
