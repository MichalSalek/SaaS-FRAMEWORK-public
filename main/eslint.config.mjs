// eslint.config.mjs
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import importPlugin from 'eslint-plugin-import';
import { readdirSync } from 'node:fs';
import { guardConfigs } from './eslint-rules/index.mjs';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// `no-restricted-syntax` selectors as NAMED CONSTANTS, and why.
//
// DECISION: in a flat config a later block REPLACES a rule entirely, it does not merge. That silently
// killed the `aria-label` literal ratchet: a later block with a superset scope
// (`src/**\/*.{ts,tsx}`) replaced the whole `no-restricted-syntax` array in `components/**`.
//
// So rules live in named groups and every block COMPOSES the full set that applies to it (a narrower
// block is a superset of the wider one and stands BELOW it). Adding a group: add it to EVERY block
// that covers its files.
// ─────────────────────────────────────────────────────────────────────────────

// Control inside a control: interactive elements nested wrongly give a double tab stop, the screen
// reader announces a link AND a button, and a click in the middle depends on propagation.
// jsx-a11y has no rule for this nesting.
const CONTROL_IN_CONTROL_SELECTORS = [
  {
    selector:
      'JSXElement[openingElement.name.name=/^(a|Link|LinkButtonAtom)$/] JSXElement[openingElement.name.name=/^(button|ButtonAtom|a|Link|LinkButtonAtom)$/]',
    message:
      'Kontrolka w kontrolce: link/anchor nie może zawierać przycisku ani innego linku. Użyj LinkButtonAtom (jeden <a> jak przycisk) albo rozdziel elementy.',
  },
  {
    selector:
      'JSXElement[openingElement.name.name=/^(button|ButtonAtom)$/] JSXElement[openingElement.name.name=/^(button|ButtonAtom|a|Link|LinkButtonAtom|input|textarea|select)$/]',
    message:
      'Kontrolka w kontrolce: przycisk nie może zawierać innej kontrolki. Przycisk obejmuje tylko nagłówek/etykietę, interaktywna treść to rodzeństwo.',
  },
];

// queryFn without `signal`. The toast policy (application/http/error-feedback.policy.ts) tells a
// screen read by the abort signal TanStack passes to queryFn: a read with a signal does not toast,
// because the screen renders the error itself. A queryFn that drops the signal toasts twice (screen
// plus toast) and does not abort the request on unmount. The selector looks only at the function
// DIRECTLY under `queryFn` (also in a `? :` branch with `skipToken`), so nested callbacks in the
// body do not confuse it.
const QUERYFN_SIGNAL_SELECTORS = [
  {
    selector:
      "Property[key.name='queryFn'] > ArrowFunctionExpression:not(:has(Identifier[name='signal']))",
    message:
      'queryFn musi przyjąć { signal } i przekazać go do wywołania IO (polityka toastów + przerywanie zapytań). Wzorzec: queryFn: ({ signal }) => fn(req, { signal }).',
  },
  {
    selector:
      "Property[key.name='queryFn'] > ConditionalExpression > ArrowFunctionExpression:not(:has(Identifier[name='signal']))",
    message:
      'queryFn musi przyjąć { signal } i przekazać go do wywołania IO (polityka toastów + przerywanie zapytań).',
  },
];

// A toast with a literal is copy outside i18n. The first argument must be an event
// (APP_EVENTS.*) or t('key').
const SNACKBAR_LITERAL_SELECTORS = [
  {
    selector:
      "CallExpression[callee.name='pushNewSnackbar'][arguments.0.type='TemplateLiteral']",
    message:
      'pushNewSnackbar z template-literalem = copy poza i18n. Podaj event (APP_EVENTS.*) albo t(klucz, params).',
  },
  {
    selector:
      "CallExpression[callee.name='pushNewSnackbar'][arguments.0.type='Literal'][arguments.0.value=/[A-Za-z]/]",
    message:
      'pushNewSnackbar ze stringiem = copy poza i18n. Podaj event (APP_EVENTS.*) albo t(klucz).',
  },
];

// ONE select in the app: SelectAtom (native <select>, DECISION in Select.atom.tsx). A second,
// popup select once rendered every option but the chosen one as „S..”; neither a Base UI Select
// nor a raw <select> outside the atom may come back. The raw-<select> selector is its own constant
// so the atom's override below drops ONLY that one and keeps the import bans.
const RAW_SELECT_SELECTORS = [
  {
    selector: "JSXOpeningElement[name.name='select']",
    message:
      'Surowy <select> poza SelectAtom: użyj SelectAtom (components/Select).',
  },
];
const SINGLE_SELECT_IMPORT_SELECTORS = [
  {
    selector:
      "ImportDeclaration[source.value='@base-ui-components/react/select']",
    message:
      'Jedyny select to SelectAtom (components/Select). W pasku filtrów: density="compact".',
  },
  {
    selector:
      "ImportDeclaration[source.value='@base-ui-components/react'] ImportSpecifier[imported.name='Select']",
    message:
      'Jedyny select to SelectAtom (components/Select). W pasku filtrów: density="compact".',
  },
];
const SINGLE_SELECT_SELECTORS = [
  ...SINGLE_SELECT_IMPORT_SELECTORS,
  ...RAW_SELECT_SELECTORS,
];

// A literal in aria-label: a label read by a screen reader must be a translation.
const ARIA_LABEL_LITERAL_SELECTORS = [
  {
    selector: "JSXAttribute[name.name='aria-label'] > Literal",
    message:
      'aria-label nie może być literałem — podaj tłumaczenie (useTranslations) albo prop. Nazwa własna: wyjątek per plik w eslint.config.mjs z powodem.',
  },
];

// Cross-feature boundary: a feature MUST NOT reach into another feature's
// internals (hooks/components/sections/parts). Shared cross-feature code lives
// in features/shared/** (the only allowed umbrella). Top-level feature imports
// (page composition) stay allowed. Explicit dir enumeration (NOT a wildcard)
// avoids false-positives on ../helpers, ../<x>.types, etc.
// DECISION: the feature list is read from the directory, not typed by hand. The hand-kept list
// had fallen ten features behind (checkout, messaging, notifications, salon-profile ...), and a
// feature missing from it was simply not protected.
const NON_SHARED_FEATURE_DIRS = readdirSync(
  fileURLToPath(new URL('./src/UI/features', import.meta.url)),
  { withFileTypes: true }
)
  .filter(entry => entry.isDirectory() && entry.name !== 'shared')
  .map(entry => entry.name)
  .sort();
// NOTE: ESLint no-restricted-imports matches import sources with gitignore-style
// semantics (single-segment `*`, NO brace expansion {a,b,c}). Patterns MUST be
// fully expanded per subdir — a braced pattern silently matches NOTHING
// (false-negative on every cross-feature import).
const FEATURE_INTERNAL_SUBDIRS = ['hooks', 'components', 'sections', 'parts'];
const CROSS_FEATURE_INTERNAL_GROUPS = NON_SHARED_FEATURE_DIRS.flatMap(dir =>
  FEATURE_INTERNAL_SUBDIRS.flatMap(sub =>
    ['../', '../../', '../../../'].flatMap(up => [
      `${up}${dir}/${sub}/**`, // internals directly under the feature root
      `${up}${dir}/*/${sub}/**`, // internals nested one page-dir deep (e.g. admin/AdminFooPage/components/**)
    ])
  )
);

// `no-restricted-imports` sees only static imports, so `dynamic(() => import('../<other>/components/X'))`
// slipped past the boundary (a gallery page lazy-loaded the moderation dialog that way). The same
// boundary for `import()` expressions, built from the same feature list.
const CROSS_FEATURE_DYNAMIC_IMPORT_SELECTORS = [
  {
    selector: `ImportExpression[source.value=/^(\\.\\.\\/){1,3}(${NON_SHARED_FEATURE_DIRS.join('|')})\\/([^\\/]+\\/)?(${FEATURE_INTERNAL_SUBDIRS.join('|')})\\//]`,
    message:
      "Cross-feature dynamic import: do not lazy-load another feature's hooks/components/sections/parts. Move the shared piece to features/shared/**.",
  },
];

export default defineConfig([
  // DECISION: no lint configuration in comments. Every exception lives in THIS file as a per-file
  // override with its reason, so the full set of exceptions is reviewable in one place and a
  // drive-by `eslint-disable` cannot switch a rule off. With `noInlineConfig` ESLint reports any
  // directive comment as a warning, and `--max-warnings 0` makes that blocking.
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
        project: './tsconfig.json',
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@next/next': nextPlugin,
      'react-hooks': reactHooksPlugin,
      prettier: prettierPlugin,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...nextPlugin.configs['core-web-vitals'].rules,
      // Raw <img> blocks on its own (core-web-vitals ships it as a warning). Exceptions: the
      // per-file override „Raw <img>” below. This rule replaced the <img> half of
      // `audit:bundle-budget`.
      '@next/next/no-img-element': 'error',

      // DECISION: the maintained hooks plugin owns compiler diagnostics. The retired standalone
      // plugin requires vulnerable Zod 3; forcing Zod 4 breaks its function schemas at import.
      // Rationale: https://react.dev/reference/eslint-plugin-react-hooks
      ...reactHooksPlugin.configs.flat.recommended.rules,
      // Preserve the previous compiler policy: refs were explicitly disabled, effect-state
      // and purity validation defaulted to false, and library bailouts were not errors.
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/incompatible-library': 'off',

      // 🔹 Accessibility — static a11y layer (WCAG AA). Runtime
      // axe-core covers what static can't; here = the deterministic ratchet.
      ...jsxA11y.flatConfigs.recommended.rules,

      // 🔹 React Hooks — key for WebStorm hints
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // 🔹 TypeScript
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

      // 🔹 Code quality
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'all'],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-implicit-coercion': 'error',
      'max-lines': [
        'error',
        { max: 300, skipBlankLines: true, skipComments: true },
      ],

      // 🔹 Prettier formatting
      'prettier/prettier': 'error',
    },
    settings: {
      // Enable cache for faster linting
      cache: true,
    },
  },

  // Boundary enforcement: application/ cannot import from domain/ NOR UI/.
  // application/ is the framework-agnostic core; both domain/ and UI/ depend
  // ON it, never the other way. (Shared stores live in application/stores/ so AnalyticsScripts and
  // AppLifecycle do not reach into UI/.)
  {
    files: ['src/application/**/*.ts', 'src/application/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '../domain/**',
                '../../domain/**',
                '../../../domain/**',
                '../../../../domain/**',
              ],
              message:
                'application/ nie moze importowac z domain/. Kierunek zaleznosci: domain/ → application/.',
            },
            {
              group: [
                '../UI/**',
                '../../UI/**',
                '../../../UI/**',
                '../../../../UI/**',
              ],
              message:
                'application/ nie moze importowac z UI/. Kierunek zaleznosci: UI/ → application/.',
            },
          ],
        },
      ],
    },
  },

  // Boundary enforcement: cross-feature internals are off-limits.
  // features/<a> must not import features/<b>/{hooks,components,sections,parts}.
  // Shared cross-feature code goes through features/shared/** instead.
  {
    files: ['src/UI/features/**/*.ts', 'src/UI/features/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: CROSS_FEATURE_INTERNAL_GROUPS,
              message:
                'Cross-feature import zabroniony: nie siegaj do features/<inny>/{hooks,components,sections,parts}. Wspolny kod przenies do features/shared/** (jedyny dozwolony umbrella).',
            },
          ],
        },
      ],
    },
  },
  // features/shared/** is the umbrella — intra-shared imports are unrestricted
  // (its subdir names collide with feature names, so the ban above would
  // false-positive on legit shared->shared cross-subdir imports). TRADE-OFF: this
  // blanket 'off' also means shared/ is NOT prevented from reaching into a
  // non-shared feature's internals. shared/ is trusted-by-convention to depend
  // only on shared/ + app/domain/kernel (dependency direction: features -> shared,
  // never shared -> features). Tighten later via a shared-subdir allow-list if needed.
  {
    files: [
      'src/UI/features/shared/**/*.ts',
      'src/UI/features/shared/**/*.tsx',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  // Control inside a control + toast with a literal.
  // (1) <a>/<Link>/<LinkButtonAtom> containing <button>/<ButtonAtom> (and the reverse) is invalid
  //     nesting of interactive elements (see CONTROL_IN_CONTROL_SELECTORS). The correct pattern is
  //     LinkButtonAtom (one <a> styled as a button) or a native <button> wrapping ONLY the
  //     heading, with the content as a sibling.
  // (2) pushNewSnackbar('text' / `text ${x}`) is copy outside i18n. The first argument must be an
  //     event (APP_EVENTS.*) or t('key').
  // AST selectors: comments and strings cannot be mistaken for code.
  {
    files: ['src/**/*.tsx', 'src/**/*.ts'],
    ignores: ['**/*.test.tsx', '**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...CONTROL_IN_CONTROL_SELECTORS,
        ...SNACKBAR_LITERAL_SELECTORS,
        ...SINGLE_SELECT_SELECTORS,
        ...QUERYFN_SIGNAL_SELECTORS,
      ],
    },
  },

  // Features (except the shared umbrella) also get the cross-feature ban for `import()`. Narrower
  // block below the global one, so it repeats the global set (see the DECISION at the top).
  {
    files: ['src/UI/features/**/*.ts', 'src/UI/features/**/*.tsx'],
    ignores: ['**/*.test.tsx', '**/*.test.ts', 'src/UI/features/shared/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...CONTROL_IN_CONTROL_SELECTORS,
        ...SNACKBAR_LITERAL_SELECTORS,
        ...SINGLE_SELECT_SELECTORS,
        ...QUERYFN_SIGNAL_SELECTORS,
        ...CROSS_FEATURE_DYNAMIC_IMPORT_SELECTORS,
      ],
    },
  },

  // An accessible name in the component library must be TRANSLATED.
  //
  // DECISION: an AST rule, not a grep audit. Screen-reader names are invisible, so viewing the page
  // never verifies them, and the product speaks three languages. grep cannot tell the `aria-label`
  // attribute from a prop of that name, or code from comment prose; an AST selector can. Scope is
  // `components/**` (baseline zero); legitimate literals outside it (social network names in the
  // footer, the dev-only UI library) would otherwise need an allowlist. A proper name that must not
  // be translated gets a per-file override in this config, with a reason (inline directives are
  // disabled repo-wide, see `linterOptions` below).
  // The narrower block stands BELOW and repeats the full rule set of the wider one plus its own;
  // without the repetition the wider ratchets would vanish in components/ (see the DECISION on the
  // named selector constants above).
  {
    files: ['src/UI/components/**/*.tsx'],
    ignores: ['**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...CONTROL_IN_CONTROL_SELECTORS,
        ...SNACKBAR_LITERAL_SELECTORS,
        ...SINGLE_SELECT_SELECTORS,
        ...QUERYFN_SIGNAL_SELECTORS,
        ...ARIA_LABEL_LITERAL_SELECTORS,
      ],
    },
  },

  // DECISION: SelectAtom is the one place a native <select> lives (DECISION in Select.atom.tsx),
  // so ONLY the raw-<select> selector is dropped here; every other selector of the components
  // block still applies to this file.
  {
    files: ['src/UI/components/Select/Select.atom.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...CONTROL_IN_CONTROL_SELECTORS,
        ...SNACKBAR_LITERAL_SELECTORS,
        ...SINGLE_SELECT_IMPORT_SELECTORS,
        ...QUERYFN_SIGNAL_SELECTORS,
        ...ARIA_LABEL_LITERAL_SELECTORS,
      ],
    },
  },

  // DECISION: raw <img> where next/image is wrong, one file per entry with its reason. Images
  // are user uploads served and resized by Cloudinary (the CDN crops and sizes them; next/image
  // would re-optimize an already optimized URL), client-generated data-URL QR codes at a fixed
  // size, local object-URL previews inside the crop tools, and one tiny static SVG. A new file
  // with a raw <img> fails lint until it is argued for here.
  {
    files: [
      // tiny static SVG drawing
      'src/UI/components/Illustration/Illustration.atom.tsx',
      // Cloudinary user uploads (CDN crops and sizes, srcSet)
      'src/UI/components/GalleryPhotoCard/GalleryPhotoCard.organism.tsx',
      'src/UI/features/gallery/PhotoDetailPage.parts.composition.tsx',
      'src/UI/features/gallery/components/SimilarSection.organism.tsx',
      'src/UI/features/explore/components/StylistCard.organism.tsx',
      'src/UI/features/admin/ReportCard.organism.tsx',
      'src/UI/features/account/components/PinnedManager.organism.tsx',
      'src/UI/features/account/components/PinnedOrder.molecule.tsx',
      'src/UI/features/sessions/SessionPhotos.organism.tsx',
      'src/UI/features/sessions/components/SessionConclusionCard.organism.tsx',
      // client-generated data-URL QR at a fixed size
      'src/UI/features/pairing/StylistPermanentCode.organism.tsx',
      'src/UI/features/static/GetAppQr.molecule.tsx',
      // local object-URL preview inside the crop tool
      'src/UI/features/gallery/components/CropStep.organism.tsx',
      'src/UI/features/account/components/AvatarCropDialog.organism.tsx',
    ],
    rules: {
      '@next/next/no-img-element': 'off',
    },
  },

  // DECISION: effects that omit a dependency on purpose, each extracted into its own
  // single-purpose hook file so the override covers that effect and nothing else (the components
  // and hooks that call them are linted in full): config constants and refs gated on one toggle,
  // a fire-once action, an unmount-only cleanup, a populate-once from server data, a URL write
  // that must not re-fire on its own router update. Each hook starts with 'use no memo', which
  // keeps the React Compiler from compiling around the omission, as the former inline
  // suppressions did.
  {
    files: [
      'src/UI/hooks/useFocusTrapActivation.ts',
      'src/UI/shared/hooks/useUrlStateWriter.ts',
      'src/UI/features/checkout/components/useCheckoutElementAutofocus.ts',
      'src/UI/features/checkout/components/useCheckoutUnmountRelease.ts',
      'src/UI/features/email/useUnsubscribeOnce.ts',
      'src/UI/features/admin/hooks/useInitialPermissionMatrix.ts',
    ],
    rules: {
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  // The same six files, compiler half: under 'use no memo' the compiler rule either calls the
  // directive unnecessary (three files) or flags the hook writing `.current` on a ref it received
  // as an argument (three files); neither matters for a function the compiler does not compile.
  // Keeping the directive keeps production on the behaviour it had under the inline suppressions.
  {
    files: [
      'src/UI/hooks/useFocusTrapActivation.ts',
      'src/UI/shared/hooks/useUrlStateWriter.ts',
      'src/UI/features/checkout/components/useCheckoutElementAutofocus.ts',
      'src/UI/features/checkout/components/useCheckoutUnmountRelease.ts',
      'src/UI/features/email/useUnsubscribeOnce.ts',
      'src/UI/features/admin/hooks/useInitialPermissionMatrix.ts',
    ],
    rules: {
      ...Object.fromEntries(
        Object.keys(reactHooksPlugin.configs.flat.recommended.rules)
          .filter(name => name !== 'react-hooks/rules-of-hooks')
          .map(name => [name, 'off'])
      ),
    },
  },

  // This document belongs to the iframe, not React state. The compiler infers the DOM node
  // obtained from state as immutable and flags intentional theme updates on that external DOM.
  {
    files: ['src/UI/features/dev/playground/PlaygroundFrame.organism.tsx'],
    rules: { 'react-hooks/immutability': 'off' },
  },

  // Atomic-design layer direction (acyclic, low<-high). The .tsx suffix encodes the layer
  // (ATOMIC_LAYERS.md is the SSOT). A lower layer does NOT import a higher one.
  // DECISION: Section.composition is a foundational layout primitive (zero deps, plain wrapper) and
  // is allowed for every layer. The organism restriction targets cross-cutting/SEO compositions
  // (ErrorBoundary/JsonLd/PublicSeoHead/InfiniteScrollTrigger) that content components must not pull.
  {
    files: ['src/UI/components/**/*.atom.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/*.molecule', '**/*.organism', '**/*.composition'],
              message:
                'ATOM nie może importować wyższych warstw (molecule/organism/composition). Kierunek: atom ← molecule ← organism ← composition.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/UI/components/**/*.molecule.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/*.organism', '**/*.composition'],
              message:
                'MOLECULE nie może importować organism/composition. Komponuje TYLKO atomy.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/UI/components/**/*.organism.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/ErrorBoundary.composition',
                '**/JsonLd.composition',
                '**/PublicSeoHead.composition',
                '**/InfiniteScrollTrigger.composition',
              ],
              message:
                'ORGANISM nie może importować cross-cutting/SEO composition (ErrorBoundary/JsonLd/PublicSeoHead/InfiniteScrollTrigger). Foundational layout Section.composition jest dozwolony (DECISION).',
            },
          ],
        },
      ],
    },
  },

  // Export style: named-only in src/UI + src/application. Readable imports, better tree-shaking,
  // compatible with the ts-morph rename. pages/ + next-config/middleware are framework-required
  // defaults (allowlist below).
  {
    files: ['src/UI/**/*.{ts,tsx}', 'src/application/**/*.{ts,tsx}'],
    plugins: { import: importPlugin },
    rules: {
      'import/no-default-export': 'error',
    },
  },

  // File-specific overrides
  {
    // AppLayout — the single user-shell guard/branch hub (desktop-access,
    // AccountWebLayout, onboarding, redirect shells) + NVT a11y parity
    // pushed it past 300. Branches are load-bearing and read top-down; split
    // only if a bounded shell-context emerges.
    files: ['src/UI/layouts/AppLayout.composition.tsx'],
    rules: {
      'max-lines': [
        'error',
        { max: 340, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    // Dashboard stylist organism — single component managing hero, onboarding,
    // stats, paired-clients, notes and quick-actions. Split into sub-organisms
    // only when a clear bounded context emerges; inline for now (DASH pattern).
    files: [
      'src/UI/features/dashboard/components/StylistDashboard.organism.tsx',
    ],
    rules: {
      'max-lines': [
        'error',
        { max: 340, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: [
      'src/UI/features/gallery/UploadAssetPage.composition.tsx',
      'src/UI/features/shared/SharedPage.composition.tsx',
      'src/UI/features/salon-staff/SalonStaffPage.composition.tsx',
    ],
    rules: {
      'max-lines': [
        'error',
        { max: 500, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ['src/UI/features/support/SupportThreadListPage.composition.tsx'],
    rules: {
      'max-lines': [
        'error',
        { max: 600, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    // Live-library registry = data file (one entry per shared component +
    // render). Legitimately long; the modularity budget is for logic, not data.
    files: ['src/UI/features/ui-library/uiLibrary.registry*.ts'],
    rules: {
      'max-lines': [
        'error',
        { max: 800, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    // Dev-only recon routes (/dev/architecture, /dev/api):
    // self-contained single-file artifacts — inline CSS + HTML body strings,
    // zero external deps (the playground-skill archetype). Dev-gated + noindex.
    // The modularity budget (300) targets product logic, not these one-file
    // dev visualisations; splitting them would defeat their "open one file" point.
    files: ['src/pages/dev/architecture.tsx', 'src/pages/dev/api.tsx'],
    rules: {
      'max-lines': [
        'error',
        // Bumped 1100 -> 1500: /dev/architecture (the SSOT recon page) grew with the
        // ongoing architecture analysis. Per the rationale above these dev-only single
        // -file recon artifacts are intentionally monolithic — the ceiling tracks the
        // page, it is not a product-logic budget.
        { max: 1500, skipBlankLines: true, skipComments: true },
      ],
    },
  },

  // The Vitest setup file sits outside src/ and outside tsconfig.json (it must never enter the
  // next build), so it gets its own typed project, `tsconfig.vitest.json`, which
  // `scripts/typecheck/check-all` also type-checks.
  {
    files: ['vitest.setup.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.vitest.json',
      },
    },
  },

  // Test files: max-lines does not apply. A characterization test that covers
  // every branch of a 13-function module is legitimately long; the modularity
  // budget (300) is for production code, not test suites. All other rules
  // (no-any, no-non-null, prettier, type-imports) still apply.
  {
    files: ['**/*.test.{ts,tsx}', 'src/test-utils/**/*.{ts,tsx}'],
    rules: {
      'max-lines': 'off',
    },
  },

  // Local guard rules (`nf/*`, eslint-rules/): the AST successors of grep audits from tests/audit
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
      // The Vitest config lives outside src/ (kept out of tsconfig so it never enters the next
      // build) and is checked by Vitest itself. `vitest.setup.ts` IS linted, through its own
      // tsconfig (block above).
      'vitest.config.ts',
      'coverage/**',
      'node_modules/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      'public/**',
      'scripts/**',
      'src/READONLY-shared-kernel/**',
      'native-wrapper/**',
      '**/prisma/js-client/**',
      '**/prisma-event-log-store/js-client/**',
    ],
  },
]);
