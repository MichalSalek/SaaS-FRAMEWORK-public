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
import reactCompiler from 'eslint-plugin-react-compiler';

// ─────────────────────────────────────────────────────────────────────────────
// Selektory `no-restricted-syntax` jako NAZWANE STAŁE — i dlaczego akurat tak.
//
// DECISION (nie usuwaj tego komentarza):
// We flat-configu późniejszy blok NADPISUJE regułę W CAŁOŚCI, nie scala jej.
// Ta własność ZABIŁA już jeden ratchet w tym repo, po cichu i na kilka miesięcy:
// ratchet literału w `aria-label` (S103) miał zakres `src/UI/components/**\/*.tsx`,
// a dołożony później ratchet S104 (kontrolka-w-kontrolce + toast z literałem) ma
// zakres `src/**\/*.{ts,tsx}` — czyli NADZBIÓR tamtego. Ponieważ stał niżej,
// zastępował całą tablicę `no-restricted-syntax` i w CAŁYM swoim zakresie, czyli
// dokładnie tam, gdzie reguła aria-label miała pilnować, przestawała ona istnieć.
// Zmierzone wstrzyknięciem (S121): literał w `aria-label` w pliku z components/
// przechodził lint bez słowa, a `pushNewSnackbar('tekst')` w TYM SAMYM pliku był
// łapany — czyli blok S104 działał, a S103 był martwy.
//
// Dlatego reguły żyją w nazwanych grupach i każdy blok SKŁADA pełen komplet,
// który go dotyczy (blok węższy = nadzbiór reguł bloku szerszego, i stoi NIŻEJ).
// Dokładając nową grupę: dopisz ją do KAŻDEGO bloku, który obejmuje jej pliki.
// ─────────────────────────────────────────────────────────────────────────────

// (S104) Kontrolka w kontrolce: nieprawidłowe zagnieżdżenie elementów interaktywnych
// — podwójny tab-stop, czytnik ogłasza link ORAZ przycisk, klik w środek zależy od
// propagacji. jsx-a11y nie ma reguły na to zagnieżdżenie.
const CONTROL_IN_CONTROL_SELECTORS = [
  {
    selector:
      "JSXElement[openingElement.name.name=/^(a|Link|LinkButtonAtom)$/] JSXElement[openingElement.name.name=/^(button|ButtonAtom|a|Link|LinkButtonAtom)$/]",
    message:
      'Kontrolka w kontrolce: link/anchor nie może zawierać przycisku ani innego linku. Użyj LinkButtonAtom (jeden <a> jak przycisk) albo rozdziel elementy.',
  },
  {
    selector:
      "JSXElement[openingElement.name.name=/^(button|ButtonAtom)$/] JSXElement[openingElement.name.name=/^(button|ButtonAtom|a|Link|LinkButtonAtom|input|textarea|select)$/]",
    message:
      'Kontrolka w kontrolce: przycisk nie może zawierać innej kontrolki. Przycisk obejmuje tylko nagłówek/etykietę, interaktywna treść to rodzeństwo.',
  },
];

// (S124) queryFn bez `signal`. Polityka toastów (application/http/
// error-feedback.policy.ts) rozpoznaje odczyt ekranu po sygnale przerwania, który
// TanStack podaje do queryFn: odczyt z sygnałem nie toastuje, bo ekran sam
// renderuje błąd. queryFn, które sygnału nie przekazuje, toastuje podwójnie
// (ekran + toast) i nie przerywa zapytania przy odmontowaniu. Selektor patrzy
// tylko na funkcję stojącą BEZPOŚREDNIO pod `queryFn` (także w gałęzi `? :`
// ze `skipToken`), więc zagnieżdżone callbacki w ciele go nie mylą.
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

// (S104) Toast z literałem = copy poza i18n. Pierwszy argument ma być eventem
// (APP_EVENTS.*) albo t('klucz').
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

// (S103) Literał w aria-label — etykieta czytana przez SR musi być tłumaczeniem.
const ARIA_LABEL_LITERAL_SELECTORS = [
  {
    selector: "JSXAttribute[name.name='aria-label'] > Literal",
    message:
      'aria-label nie może być literałem — podaj tłumaczenie (useTranslations) albo prop. Nazwa własna: eslint-disable-next-line z powodem.',
  },
];

// Cross-feature boundary: a feature MUST NOT reach into another feature's
// internals (hooks/components/sections/parts). Shared cross-feature code lives
// in features/shared/** (the only allowed umbrella). Top-level feature imports
// (page composition) stay allowed. Explicit dir enumeration (NOT a wildcard)
// avoids false-positives on ../helpers, ../<x>.types, etc.
const NON_SHARED_FEATURE_DIRS = [
  'account',
  'admin',
  'announcements',
  'auth',
  'blog',
  'client',
  'dashboard',
  'email',
  'explore',
  'favorites',
  'gallery',
  'home',
  'maintenance',
  'moderation',
  'pairing',
  'salon-staff',
  'sessions',
  'static',
  'stylist',
  'support',
];
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

export default defineConfig([
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
      'react-compiler': reactCompiler,
    },
    rules: {
      ...nextPlugin.configs['core-web-vitals'].rules,

      // 🔹 React Compiler (FQC FAZA 2) — Rules-of-React ratchet. Violations =
      // code the compiler cannot safely memoize (mutation-in-render, conditional
      // hooks). Must be clean before enabling the compiler in next.config.
      'react-compiler/react-compiler': 'error',

      // 🔹 Accessibility (FDX FAZA 8) — static a11y layer (WCAG AA). Runtime
      // axe-core covers what static can't; here = the deterministic ratchet.
      ...jsxA11y.flatConfigs.recommended.rules,

      // 🔹 React Hooks — kluczowe dla podpowiedzi w WebStorm
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // 🔹 TypeScript
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
  // ON it, never the other way. (W1.1: cookieConsent/navDirection stores moved
  // to application/stores/ so AnalyticsScripts/AppLifecycle stop reaching into UI/.)
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

  // Kontrolka w kontrolce + toast z literałem (ratchet S104).
  // (1) <a>/<Link>/<LinkButtonAtom> zawierające <button>/<ButtonAtom> (i odwrotnie)
  //     to nieprawidłowe zagnieżdżenie interaktywnych elementów: podwójny tab-stop,
  //     czytnik ogłasza link ORAZ przycisk, klik w środek zależy od propagacji.
  //     jsx-a11y nie ma reguły na to zagnieżdżenie. Klasa wróciła po S103
  //     (kadr role='button' z sercem w środku) jako <Link><ButtonAtom/></Link>
  //     w CTA planów (2 pliki) i karta raportu z textarea/przyciskami w środku.
  //     Poprawny wzorzec: LinkButtonAtom (jeden <a> stylizowany jak przycisk)
  //     albo natywny <button> obejmujący TYLKO nagłówek, treść jako rodzeństwo.
  // (2) pushNewSnackbar('tekst'/`tekst ${x}`) = copy poza i18n; cztery hooki bulk
  //     w adminie miały polskie toasty bez diakrytyki. Pierwszy argument ma być
  //     eventem (APP_EVENTS.*) albo t('klucz').
  // Selektor AST: komentarze i stringi nie mylą go z kodem (lekcja S103).
  {
    files: ['src/**/*.tsx', 'src/**/*.ts'],
    ignores: ['**/*.test.tsx', '**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...CONTROL_IN_CONTROL_SELECTORS,
        ...SNACKBAR_LITERAL_SELECTORS,
        ...QUERYFN_SIGNAL_SELECTORS,
      ],
    },
  },

  // Dostępna nazwa w bibliotece komponentów musi być TŁUMACZONA.
  //
  // DECISION (nie usuwaj tego komentarza): reguła AST, nie grep-audyt. Nazwy dla
  // czytnika ekranu są NIEWIDOCZNE — żadne oglądanie strony ich nie zweryfikuje,
  // a produkt mówi w trzech językach. Census S103 znalazł w tym katalogu cztery
  // sztuki: „Remove {label}" na chipie filtra (produkcyjnie na Odkrywaj), „Loading"
  // na pasku i spinnerze (nieskończony scroll galerii, wysyłka zdjęcia) oraz
  // „Bottom navigation" — przy istniejącym od dawna kluczu `bottomNav.navAriaLabel`
  // w trzech językach.
  //
  // Dlaczego ESLint, a nie tests/audit/*.sh: grep nie odróżnia atrybutu `aria-label`
  // od propa o tej nazwie ani nie widzi, czy literał stoi w kodzie, czy w prozie
  // komentarza (na tę drugą pułapkę repo nadziało się już dwa razy). Selektor AST
  // rozstrzyga oba pytania z definicji.
  //
  // Zakres to `components/**`, bo tu wada mnoży się przez wszystkie wywołania i tu
  // baseline wynosi zero. Poza tym katalogiem zostają uzasadnione literały (nazwy
  // własne sieci społecznościowych w stopce, dev-only biblioteka UI) — obejmowanie
  // ich wymagałoby allowlisty, czyli zamiany reguły w miejsce na wyjątki.
  //
  // Nazwa własna, która NIE podlega tłumaczeniu, przechodzi przez zwykłe
  // `eslint-disable-next-line` z powodem.
  // Blok WEZSZY stoi NIZEJ i powtarza komplet reguł bloku szerszego + własną.
  // Bez tego powtórzenia ratchety S104 znikłyby w components/ — dokładnie tak,
  // jak wcześniej znikał tu ratchet aria-label (patrz DECISION przy stałych).
  {
    files: ['src/UI/components/**/*.tsx'],
    ignores: ['**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...CONTROL_IN_CONTROL_SELECTORS,
        ...SNACKBAR_LITERAL_SELECTORS,
        ...QUERYFN_SIGNAL_SELECTORS,
        ...ARIA_LABEL_LITERAL_SELECTORS,
      ],
    },
  },

  // Atomic-design layer direction (acyclic, low←high). Sufiks na .tsx koduje
  // warstwę (ATOMIC_LAYERS.md SSOT). Niższa warstwa NIE importuje wyższej.
  // DECISION (nie usuwaj): Section.composition = foundational layout primitive
  // (zero deps, czysty wrapper) — dozwolony dla każdej warstwy. Restrykcja
  // organizmu celuje w cross-cutting/SEO compositions (ErrorBoundary/JsonLd/
  // PublicSeoHead/InfiniteScrollTrigger), które content-komponenty nie powinny
  // ciągnąć. Patrz census W6.3.
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

  // Export-style: named-only w src/UI + src/application (FQC W0.5f). Czytelne
  // importy, lepszy tree-shake, zgodność z ts-morph rename (FAZA 1). pages/ +
  // next-config/middleware = framework-required default (allowlist niżej).
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
    // AccountWebLayout, onboarding, redirect shells) + NVT a11y parity (O12)
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
    // Dev-only recon/playground routes (/dev/architecture, /dev/playground):
    // self-contained single-file artifacts — inline CSS + HTML body strings,
    // zero external deps (the playground-skill archetype). Dev-gated + noindex.
    // The modularity budget (300) targets product logic, not these one-file
    // dev visualisations; splitting them would defeat their "open one file" point.
    files: [
      'src/pages/dev/architecture.tsx',
      'src/pages/dev/playground.tsx',
      'src/pages/dev/api.tsx',
    ],
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

  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'dist/**',
      'next-env.d.ts',
      // Vitest config + setup live outside src/ (kept out of tsconfig so they
      // never enter the next build); lint them via their own runtime, not the
      // app's typed lint pass.
      'vitest.config.ts',
      'vitest.setup.ts',
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
