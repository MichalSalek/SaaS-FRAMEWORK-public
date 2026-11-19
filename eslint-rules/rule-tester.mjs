// RuleTester bound to `node:test` (the root has no Vitest) and to the TypeScript parser, shared by
// every `rules/*.test.mjs` of the root workspace. Run: `npm run test:lint-guards`.
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { after, describe, it } from 'node:test';

RuleTester.afterAll = after;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

/**
 * @param {{ jsx?: boolean }} [options] JSX on for `.tsx` samples. Off by default, because in a
 *   `.ts` file `<T>value` is a type assertion and with JSX on it would not parse.
 */
export function createRuleTester(options = {}) {
  return new RuleTester({
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: options.jsx === true },
      },
    },
  });
}
