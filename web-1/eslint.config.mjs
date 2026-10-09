// eslint.config.mjs
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default defineConfig([
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
      '@typescript-eslint/ban-ts-comment': 'off',
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
  // DECISION (nie usuwaj tego komentarza):
  // Frontend (main/) ma analogiczną regułę. Backend pozwala application/ orkiestrować domain/
  // tylko w wąskich, świadomych gateway'ach (re-exports, admin service, Stripe webhooks).
  // Te pliki są w whitelist poniżej. Nowe importy application→domain MUSZĄ przejść przez gateway
  // (np. interceptors/domain-interceptors.ts) ALBO dostać świadomy whitelist tutaj z uzasadnieniem.
  // Reguła blokuje alias `@domain/*` oraz relatywne ścieżki do domain/ — `@kernel/domain/...` to shared kernel types (OK).
  {
    // testy-api s34: pagination params reach Prisma take/skip, which rejects
    // non-integers (take=1.5 → HTTP 500 on 16 endpoints). Parse them with qInt.
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

  // Whitelist: legitymowane application→domain orchestrators
  // (boundary rule wyłączona dla tych plików — patrz DECISION powyżej)
  // DECISION (nie usuwaj tego komentarza):
  // email-handler/lifecycle/** zawiera orchestrator email-lifecycle (cienki dispatcher
  // sweepu) oraz generyczne infra resolvery (email-frequency.guard, email-locale-batch.resolver).
  // Orchestrator komponuje domain operations (trial-emails, dunning-downgrade, admin-alerts,
  // renewal-reminder, winback-deletion) i domain types (StylistAccountWithStats).
  // Pattern 1:1 z interceptors/** — application warstwa orchestracyjna wywołująca pure domain
  // logic. D5 (run 25): orchestrator ma side effects (DB write, email send, retry) i należy
  // do application — ZOSTAJE tu. FWE Wave E: czysto-domenowe resolvery + pętla trial-email
  // przeniesione do domain/email/operations/ (trial-emails.operation.ts) i domain/email/
  // (trial-email.resolver, email-personalization.resolver), beside renewal/winback siblings.
  // Domain types pozostają w domain (StylistAccountWithStats jest też używany przez domain
  // operations). Glob `lifecycle/**` obejmuje teraz orchestrator + 2 infra resolvery.
  //
  // PLQS Wave 4D: admin-impersonation.utils.ts is an application-layer security gate
  // wrapping the domain-layer HMAC verify helper. It is called from sensitive HTTP
  // handlers (change-email, delete/self) BEFORE business logic; it needs direct
  // access to verifyImpersonationBackup to identify the admin behind an impersonated
  // session. The domain util stays in domain/admin (D23 backup token lifecycle).
  //
  // 2026-10-09: the rule matched only relative paths while every import uses the
  // `@domain/*` alias, so it could not fire. The alias is now in the pattern and the two
  // remaining cases are listed: event-log-io.wrapper.ts resolves the acting user through
  // the user slice directly (the interceptors barrel would close 27 import cycles, see
  // the comment in that file), and application tests may compose domain fixtures.
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
  // DECISION (nie usuwaj tego komentarza):
  // email-lifecycle.orchestrator.ts CELOWO NIE jest już tu wpisany (BDX W4.2). Dawny zarzut
  // "cannot be easily split without passing large shared structures across module boundaries"
  // został zaadresowany, nie obejdziony: pętla trial-email wyekstrahowana do
  // domain/email/operations/trial-emails.operation.ts (FWE Wave E; uprzednio
  // email-handler/lifecycle/trial-sweep.phase.ts), a dzielone struktury (accounts + mapy lookup)
  // przekazywane są jawnie jako `TrialSweepContext` struct przez granicę modułu. Orchestrator
  // to teraz cienki dispatcher (~120 eff-LOC) i mieści się w domyślnym max-lines: 350.
  {
    files: [
      'src/application/http/error-mapper.ts',
      // Multi-phase account recovery (user, stylist account, gallery records, client account)
      // + cached_gallery_count atomic sync (D7+DD3-D1 run 24)
      'src/domain/user/operations/recovery/recovery.operations.ts',
    ],
    rules: {
      // error-mapper.ts: cap bumped 560→580 (komunikator 2026-07-16: +2 case'y
      // MESSAGING_PAIR_NOT_FOUND/MESSAGING_NOT_ALLOWED + anulowanie prośby).
      // Poprzednio: 550→560 (Turnstile 2026-07-16: +1 case
      // CAPTCHA_VERIFICATION_FAILED — anty-bot na publicznym contact-form);
      // 580→590 (QA D1–D6 2026-09-05: +CLIENT_DELETE_CRM_NOTE, MESSAGING hide/unhide);
      // 540→550 (stały QR 2026-07-11: +2 case'y PAIR_REQUEST_* —
      // anty-oracle prośby o połączenie); 500→540 (SPE Wave W1) — the monolithic
      // exhaustive switch grows by one case per new DomainError variant and is
      // deliberately NOT split (see its top-of-file DECISION: the `never`
      // completeness guarantee requires the full union in one switch). The higher
      // cap is the same conscious, bounded length-for-completeness trade as before.
      'max-lines': [
        'error',
        { max: 590, skipBlankLines: true, skipComments: true },
      ],
    },
  },

  // Fale 2026-07-16 (komunikator + pairing-cancel): dwa pliki chwilowo tuż nad
  // domyślnym capem 350 — świadomy, ograniczony bump zamiast splitu w locie
  // (pliki rosną o pojedyncze operacje; split = decyzja ich sesji-właściciela):
  //  - pair-request.operations.ts (357): +cancelPairRequest_IO (O1),
  //  - subscription-update.utils.ts (364): +owner downgrade-alert (O3).
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

  // DECISION (nie usuwaj tego komentarza):
  // error-mapper.table.test.ts is a golden-master TABLE test: one row per reachable
  // case/sub-reason of the monolithic exhaustive switch in error-mapper.ts (which
  // itself carries a max-lines override above, for the SAME reason — the switch is
  // deliberately NOT split). The row count tracks the size of the whole DomainError
  // union (~80 variants), so the file is intrinsically long; splitting it per-domain
  // would mirror exactly the split the source forbids (it would lose the single-table
  // golden-master guarantee). The higher cap is a conscious, bounded exception scoped
  // to this one characterization file.
  {
    files: ['src/test-utils/kernel-policies/error-mapper.table.test.ts'],
    rules: {
      'max-lines': [
        'error',
        { max: 1000, skipBlankLines: true, skipComments: true },
      ],
    },
  },

  // DECISION (nie usuwaj tego komentarza):
  // validation/*.validation.test.ts są golden-master CHARACTERIZATION testy (FWE Wave H
  // FAZA 1) — jeden plik per kernel-validator-domena, comprehensive: valid + per-pole
  // invalid + boundary + security-edge dla każdego z 86 walidatorów. Tak jak
  // error-mapper.table powyżej, są intrinsically long (liczba it() śledzi liczbę
  // walidatorów × ich pól), a splitowanie per-grupę rozbiłoby siatkę-bezpieczeństwa,
  // którą migracja na zod (FAZA 2) musi zachować w całości. Bounded exception, skopowany
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
      'env.d.ts',
      'open-next.config.ts',
      // Vitest config is a root-level config file outside tsconfig's `src/**` include,
      // so the typed-lint `parserOptions.project` can't resolve it (same rationale as
      // open-next.config.ts above). Type-checked by vitest itself, not by lint.
      'vitest.config.ts',
    ],
  },
]);
