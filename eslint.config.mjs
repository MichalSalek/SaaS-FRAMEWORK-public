// eslint.config.mjs — LINT WSPÓLNEGO JĄDRA (`.shared-kernel/`)
//
// DECISION: the kernel is linted HERE, at its source, not in the submodules. The READONLY copies
// in main/ and web-1/ are rebuilt by `scripts/kernel/cp-kernel` (rm -rf + copy + chmod 444), so a fix
// there is lost on the next `system:kernel`; an explicit `main` lint fix would hit
// EACCES on a 444 copy; and a submodule config reaching into `../.shared-kernel` breaks a standalone
// clone. Both submodule configs keep the copies in `ignores`; `audit:kernel-lint-gate` keeps this gate.
//
// The rule set is a deliberate subset of the `web-1` config (the "TypeScript" and "Code quality"
// blocks plus prettier), without Next/React/JSX rules: the kernel is isomorphic plain TypeScript
// and contains no component. Formatting uses the root `.prettierrc.json`, the same file both
// submodules use, so source and copies do not drift.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import { guardConfigs } from './eslint-rules/index.mjs';

export default [
  // DECISION: no lint configuration in comments (parity with main/ and web-1/). Every exception
  // lives in this file as a per-file override with its reason; with `noInlineConfig` ESLint reports
  // any directive comment as a warning, and `--max-warnings 0` makes that blocking.
  {
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
    },
  },
  {
    // Lint the kernel and the root tests (`tests/`). The rest of the root is scripts (`scripts/`,
    // their own tsconfig and a separate `typecheck:scripts` gate) and documentation. Also outside
    // the lint of `tests/`: guard samples (`tests/audit/_fixtures`, they break rules on purpose) and artifacts.
    ignores: [
      '.playwright-mcp/**',
      '**/node_modules/**',
      'main/**',
      'web-1/**',
      'scripts/**',
      // VIDEO-KOD owns its standalone TypeScript/React checks and dependencies.
      'video/**',
      'tests/node_modules/**',
      'tests/dist/**',
      'tests/audit/_fixtures/**',
      'tests/**/playwright-report/**',
      'tests/**/test-results/**',
      'docs/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      // DECISION: the generator's output stays outside the linter. `dto-completeness` compares it
      // byte for byte with a fresh `system:generate-dto` run, so prettier formatting it makes a false
      // "schema.prisma changed without system:generate-dto" failure. The generator owns its format.
      '.shared-kernel/models/db_models.generated.dto.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,

  {
    files: ['.shared-kernel/**/*.ts'],
    languageOptions: {
      parserOptions: {
        // Typed lint against the kernel's own tsconfig (it extends `tsconfig.base.json`), so
        // type-aware rules run, including `no-floating-promises` and
        // `strict-boolean-expressions`, the rules that justified turning typed lint on.
        project: ['./tsconfig.kernel.json'],
        tsconfigRootDir: import.meta.dirname,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      // ── TypeScript (parytet z web-1/eslint.config.mjs) ──
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': true,
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-expressions': [
        'error',
        { allowShortCircuit: true, allowTernary: true },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowNullableObject: true,
          allowNullableBoolean: true,
          allowString: true,
          allowNullableString: true,
          allowNumber: true,
          allowNullableNumber: true,
        },
      ],

      // ── Code quality (parytet z web-1/eslint.config.mjs) ──
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'all'],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-implicit-coercion': 'error',
      'max-lines': [
        'error',
        { max: 350, skipBlankLines: true, skipComments: true },
      ],

      // ── Formatowanie ──
      'prettier/prettier': 'error',
    },
  },

  // DECISION: `max-lines` is off for the event registry only. `app-events.const.ts` is a flat CQRS
  // name table whose length follows the number of events, and `cqrs.types.ts` reads its
  // `EVENTS[TYPE][GROUP][number]` shape, so splitting it breaks the types. Every other rule applies.
  {
    files: ['.shared-kernel/domain/events/app-events.const.ts'],
    rules: {
      'max-lines': 'off',
    },
  },

  // DECISION: two ceilings pinned to the size on the day the linter arrived, instead of disabling the
  // rule or splitting the files: both crossed 350 only because `curly` expanded one-line `if`s. The
  // pin lets today's state pass and fails on any new line, forcing the split conversation. When a
  // file is split for real, delete its exception; never raise the number.
  {
    files: ['.shared-kernel/models/type_narrowing.ts'],
    rules: {
      'max-lines': [
        'error',
        { max: 353, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ['.shared-kernel/policies/validation/account.validation.ts'],
    rules: {
      'max-lines': [
        'error',
        { max: 363, skipBlankLines: true, skipComments: true },
      ],
    },
  },

  // DECISION: the kernel's lazy `require('fs')` (DECISION at the call site in environment.ts): the
  // `typeof window` test must sit at the require so the client build drops it. Only this file.
  {
    files: ['.shared-kernel/application/environment.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Root tests (`tests/`): HTTP smoke suites, concurrency and access runners, prod checks. Typed
  // lint through `tests/tsconfig.json` with the type-safety subset of the kernel rules: no `any`,
  // no `!`, no `@ts-*` comments, no floating or misused promises (a forgotten `await` in a race
  // test silently tests nothing). Formatting and style rules are not applied here.
  // `tests/e2e/` (Playwright specs, helpers and `journey/`) gets the same rules through its own,
  // stricter tsconfig (block below).
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tests/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': true,
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },

  // Playwright suites type-check against `tests/e2e/tsconfig.json` (strict, exactOptionalPropertyTypes),
  // so their typed lint uses the same project. The rules come from the block above.
  {
    files: ['tests/e2e/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tests/e2e/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Local guard rules (`nf/*`, eslint-rules/): the AST successors of grep audits from tests/audit,
  // for the kernel source and root tests. Run over the whole tree with presence
  // floors by eslint-rules/run-guards.mjs.
  ...guardConfigs,
];
