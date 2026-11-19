import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import unitConfig from './vitest.config';
import { MUTATION_PILOT_FILES } from './stryker.config.mjs';

/**
 * Test set of the mutation pilot (stryker.config.mjs): every unit test whose CODE names one of the mutated
 * modules (import specifier or vi.mock path), discovered by content from the src root on each run, so a new
 * test of these modules joins without editing a list.
 *
 * DECISION: see stryker.config.mjs (command runner): every mutant runs this whole narrowed set.
 */
const root = fileURLToPath(new URL('.', import.meta.url));
const moduleNames = MUTATION_PILOT_FILES.map(file =>
  basename(file).replace(/\.ts$/, '')
);

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(path);
    }
    return entry.name.endsWith('.test.ts') ? [path] : [];
  });

// Comment-blind: only quoted module paths count, a module named in prose does not pull its test in.
const namesModule = (source: string) =>
  moduleNames.some(name =>
    new RegExp(`['"][^'"\\n]*/${name.replace(/\./g, '\\.')}['"]`).test(source)
  );

const include = walk(join(root, 'src'))
  .filter(file => namesModule(readFileSync(file, 'utf8')))
  .map(file => relative(root, file));

if (include.length === 0) {
  throw new Error('Mutation pilot: no unit test imports the mutated modules.');
}

export default defineConfig({
  ...unitConfig,
  test: {
    ...unitConfig.test,
    include,
  },
});
