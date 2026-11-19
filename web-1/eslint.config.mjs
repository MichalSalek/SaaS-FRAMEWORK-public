// eslint.config.mjs
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import { guardConfigs } from './eslint-rules/index.mjs';

export default defineConfig([
  // DECISION: no lint configuration in comments. Every exception lives in THIS file as a per-file
  // override with its reason, so the full set is reviewable in one place and a drive-by
  // `eslint-disable` cannot switch a rule off. With `noInlineConfig` ESLint reports any directive
  // comment as a warning, and `--max-warnings 0` makes that blocking.
  {
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './scripts/tsconfig.json'],
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@next/next': nextPlugin,
      'react-hooks': reactHooksPlugin,
      prettier: prettierPlugin,
    },
    rules: {
      ...nextPlugin.configs['core-web-vitals'].rules,

      // React Hooks
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // TypeScript
      '@typescript-eslint/no-unused-vars': 'off',
      // No `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`: a type hole is fixed with a real
      // type, a declaration file or a narrowing, never silenced.
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

      // Code quality
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'all'],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-implicit-coercion': 'error',
      'max-lines': [
        'error',
        { max: 350, skipBlankLines: true, skipComments: true },
      ],

      // Prettier formatting
      'prettier/prettier': 'error',
    },
    settings: {
      cache: true,
    },
  },

  // Boundary enforcement: application/ cannot import from src/domain/
  // DECISION: the frontend (main/) has an analogous rule. The backend lets application/ orchestrate
  // domain/ only through narrow, deliberate gateways (re-exports, admin service, Stripe webhooks),
  // whitelisted below. New application to domain imports MUST go through a gateway (for example
  // interceptors/domain-interceptors.ts) or get a justified whitelist entry here. The rule blocks the
  // `@domain/*` alias and relative paths into domain/; `@kernel/domain/...` (kernel types) is fine.
  {
    // Pagination params reach Prisma take/skip, which rejects non-integers (take=1.5 gives an
    // HTTP 500). Parse them with qInt.
    files: ['src/pages/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name='qNum'] > Literal[value=/^(take|limit|offset|page|page_size|skip)$/]",
          message:
            'Pagination params must be integers: use qInt (query-params.utils), not qNum.',
        },
      ],
    },
  },

  {
    files: ['src/application/**/*.ts', 'src/application/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@domain/**',
                '../domain/**',
                '../../domain/**',
                '../../../domain/**',
                '../../../../domain/**',
              ],
              message:
                'application/ nie moze importowac z domain/. Uzyj gateway (interceptors/domain-interceptors.ts) lub dodaj plik do whitelisty w eslint.config.mjs z uzasadnieniem.',
            },
          ],
        },
      ],
    },
  },

  // Whitelist: legitimate application to domain orchestrators (the boundary rule is off for these
  // files; see the DECISION above).
  // DECISION: email-handler/lifecycle/** holds the email-lifecycle orchestrator (a thin sweep
  // dispatcher) and generic infra resolvers. The orchestrator has side effects (DB write, email
  // send, retry) and composes domain operations, so it belongs to application, like
  // interceptors/**. Pure-domain resolvers and the trial-email loop live in domain/email/.
  //
  // admin-impersonation.utils.ts is an application-layer security gate wrapping the domain HMAC
  // verify helper; it runs in sensitive handlers BEFORE business logic and needs
  // verifyImpersonationBackup directly.
  //
  // The rule's pattern includes the `@domain/*` alias (every import uses it). Also listed:
  // event-log-io.wrapper.ts resolves the acting user through the user slice directly (the
  // interceptors barrel would close 27 import cycles), and application tests may compose domain
  // fixtures.
  {
    files: [
      'src/application/interceptors/**/*.ts',
      'src/application/admin/user-administration.service.ts',
      'src/application/auth/admin-impersonation.utils.ts',
      'src/application/event-log/event-log-io.wrapper.ts',
      'src/application/**/*.test.ts',
      'src/application/stripe/webhooks/handlers/**/*.ts',
      'src/application/stripe/webhooks/janitor/**/*.ts',
      'src/application/email-handler/lifecycle/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  // File-specific overrides
  // email-lifecycle.orchestrator.ts is deliberately NOT listed here: it is a thin dispatcher (trial
  // loop extracted to domain/email/operations/trial-emails.operation.ts, shared structures passed as
  // `TrialSweepContext`) and fits the default max-lines of 350.
  {
    files: [
      // Multi-phase account recovery (user, stylist account, gallery records, client account)
      // + cached_gallery_count atomic sync (D7+DD3-D1 run 24)
      'src/domain/user/operations/recovery/recovery.operations.ts',
    ],
    rules: {
      'max-lines': [
        'error',
        { max: 615, skipBlankLines: true, skipComments: true },
      ],
    },
  },

  // Two files sit just above the default cap of 350: a deliberate, bounded bump instead of a
  // split (they grow by single operations):
  //  - pair-request.operations.ts: +cancelPairRequest_IO,
  //  - subscription-update.utils.ts: +owner downgrade-alert.
  {
    files: [
      'src/domain/pairing/operations/pair-request.operations.ts',
      'src/application/stripe/webhooks/handlers/subscription-update.utils.ts',
    ],
    rules: {
      'max-lines': [
        'error',
        { max: 380, skipBlankLines: true, skipComments: true },
      ],
    },
  },

  // DECISION: error-mapper.table.test.ts is a golden-master TABLE test of the composed error map
  // (error-map/domain-error.map.ts), one row per variant and sub-reason; the variants it does not list
  // are pinned in error-map/domain-error.map.test.ts. The row count tracks the whole union, so the file
  // is intrinsically long; splitting it per domain would lose the single-table guarantee. The higher
  // cap is a bounded exception for this one characterization file.
  {
    files: ['src/test-utils/kernel-policies/error-mapper.table.test.ts'],
    rules: {
      'max-lines': [
        'error',
        { max: 1000, skipBlankLines: true, skipComments: true },
      ],
    },
  },

  // DECISION: validation/*.validation.test.ts are golden-master characterization tests, one file per
  // kernel validator domain (valid, per-field invalid, boundary, security edge for every validator).
  // Their length tracks validators times fields, and splitting per group would break the safety net
  // the zod migration had to preserve whole. Bounded exception scoped to this directory.
  // do tego katalogu.
  {
    files: ['src/test-utils/kernel-policies/validation/*.validation.test.ts'],
    rules: {
      'max-lines': [
        'error',
        { max: 600, skipBlankLines: true, skipComments: true },
      ],
    },
  },

  // Local guard rules (`nf/*`, eslint-rules/): the AST successors of grep audits from tests/audit.
  // Each rule owns its root, options and allowlist in its own module; the
  // audit suite runs them over the whole tree with presence floors (eslint-rules/run-guards.mjs).
  ...guardConfigs,

  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'dist/**',
      'next-env.d.ts',
      'node_modules/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      'public/**',
      'src/READONLY-shared-kernel/**',
      '**/prisma/js-client/**',
      '**/prisma-app-logs/js-client/**',
      '.open-next/**',
      '.wrangler/**',
      // Mutation-testing sandboxes (Stryker copies the project here while it runs).
      '.stryker-tmp/**',
      'env.d.ts',
      'open-next.config.ts',
      // Vitest config is a root-level config file outside tsconfig's `src/**` include,
      // so the typed-lint `parserOptions.project` can't resolve it (same rationale as
      // open-next.config.ts above). Type-checked by vitest itself, not by lint.
      'vitest.config.ts',
      // Same for the mutation-testing Vitest config (outside tsconfig's include).
      'vitest.mutation.config.ts',
    ],
  },
]);
