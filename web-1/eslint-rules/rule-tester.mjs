// RuleTester bound to Vitest and to the TypeScript parser, shared by every `rules/*.test.mjs`.
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, it } from 'vitest';

RuleTester.afterAll = afterAll;
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
