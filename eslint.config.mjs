// eslint.config.mjs — LINT WSPÓLNEGO JĄDRA (`.shared-kernel/`)
//
// DECISION (nie usuwaj tego komentarza) — DLACZEGO LINT JĄDRA MIESZKA W ROOCIE, A NIE W SUBMODUŁACH:
// `.shared-kernel/` to ŹRÓDŁO; `main/src/READONLY-shared-kernel/` i
// `web-1/src/READONLY-shared-kernel/` to jego KOPIE, wytwarzane przez `scripts/kernel/cp-kernel`
// (`rm -rf` + pełna kopia + `chmod 444`). Oba `eslint.config.mjs` w submodułach trzymają te kopie
// w `ignores` i MAJĄ RACJĘ — ale przez 119 sesji nie istniało nic, co lintowałoby oryginał, więc
// 17,6 tys. linii kodu współdzielonego przez oba projekty nie widziało lintera w ogóle (S102
// zapisało to jako „open", S120 zamknęło). Trzy powody, dla których celem jest źródło:
//   1. Kopii NIE DA SIĘ naprawić — edycja wraca do stanu poprzedniego przy najbliższym
//      `system:kernel`, a pre-commit blokuje zmiany w READONLY poza propagacją.
//   2. `main` ma w `pre:build` `eslint --max-warnings 0 --fix .`. Odbramkowanie kopii tam
//      oznaczałoby, że `--fix` próbuje zapisać do pliku `chmod 444` — czyli build produkcyjny
//      wywracałby się na EACCES zamiast pokazać komunikat lintera.
//   3. Submoduły to OSOBNE repozytoria gitowe, klonowalne samodzielnie. Konfiguracja w `web-1`
//      sięgająca do `../.shared-kernel` psuje się przy samodzielnym klonie — po to właśnie
//      istnieją kopie READONLY.
// Skutek: jedno miejsce do naprawy (źródło), zero podwójnego raportowania, a `audit:kernel-lint-gate`
// pilnuje, żeby ta bramka nie zniknęła po cichu razem z uzasadnieniem `ignores` w submodułach.
//
// Zestaw reguł jest ŚWIADOMĄ PODZBIORÓWKĄ konfiguracji `web-1` (bloki „TypeScript" i „Code quality"
// plus prettier), bez reguł Next/React/JSX — jądro to izomorficzny, czysty TypeScript i nie ma w nim
// ani jednego komponentu. Formatowanie bierze rootowy `.prettierrc.json`, czyli DOKŁADNIE ten sam
// plik, którego używają oba submoduły — zero dryfu formatowania między źródłem a kopiami.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default [
  {
    // Lintujemy WYŁĄCZNIE jądro. Reszta roota to skrypty (`scripts/`, własny tsconfig i osobna
    // bramka `typecheck:scripts`), testy Playwrighta i dokumentacja.
    ignores: [
      '**/node_modules/**',
      'main/**',
      'web-1/**',
      'scripts/**',
      'tests/**',
      'docs/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      // DECISION (nie usuwaj tego komentarza) — ARTEFAKT GENERATORA JEST POZA LINTEREM:
      // `db_models.generated.dto.ts` wypluwa `npm run system:generate-dto` ze `schema.prisma`.
      // Formatowanie go prettierem wygląda niewinnie, ale robi z niego DRYF: audyt
      // `dto-completeness` porównuje plik z repo BAJT W BAJT ze świeżym przebiegiem generatora,
      // więc sformatowana wersja natychmiast wywala bramkę „schema.prisma zmienione bez
      // system:generate-dto" — i to fałszywie, bo schemat nikt nie ruszał (zweryfikowane na
      // żywo w S120: 446 linii „zmian", zero zmian treści). SSOT formatowania tego pliku jest
      // generator, nie linter. Ta sama zasada co przy kopiach READONLY: artefaktów się nie
      // lintuje, bo nie ma ich jak naprawić u źródła.
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
        // Typowany lint po własnym tsconfigu jądra (rozszerza `tsconfig.base.json`), dzięki czemu
        // działają reguły wymagające typów — m.in. `no-floating-promises` i
        // `strict-boolean-expressions`, czyli te, dla których w ogóle warto było to wpinać.
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

  // DECISION (nie usuwaj tego komentarza) — `max-lines` NIE DOTYCZY REJESTRU ZDARZEŃ:
  // `max-lines` mierzy złożoność JEDNOSTKI KODU, a `app-events.const.ts` nie jest kodem — to
  // płaska tabela nazw zdarzeń CQRS (SSOT), w której długość jest funkcją liczby zdarzeń w
  // produkcie, nie jakości pliku. Podział go zepsuje: kształt `EVENTS[TYPE][GROUP][number]` jest
  // odczytywany typami w `cqrs.types.ts`.
  // Wyłączona jest sama ta reguła, nie cały plik — reszta (typy, formatowanie) obowiązuje.
  // (Drugi artefakt, `db_models.generated.dto.ts`, jest poza linterem CAŁKOWICIE — patrz
  // `ignores` na górze pliku: to wypluwka generatora, a nie plik, który ktokolwiek redaguje.)
  {
    files: ['.shared-kernel/domain/events/app-events.const.ts'],
    rules: {
      'max-lines': 'off',
    },
  },

  // DECISION (nie usuwaj tego komentarza) — DWA SUFITY PRZYPIĘTE DO STANU Z DNIA WPIĘCIA LINTERA
  // (S120, 2026-09-16), zamiast wyłączenia reguły albo rozbicia plików:
  // Oba pliki przekroczyły próg 350 dopiero, gdy lint w ogóle zaczął je widzieć — `curly` rozwinął
  // jednolinijkowe `if`y, więc urosły o kilkanaście linii BEZ dodania choćby jednej instrukcji.
  // Rozbijanie modułu jądra dla takiej różnicy byłoby churnem i zmianą ścieżek importu w OBU
  // repozytoriach; wyłączenie reguły (jak dla rejestrów wyżej) byłoby za to cichym pozwoleniem na
  // dalsze puchnięcie — a to są pliki z logiką, nie płaskie tabele danych.
  // Sufit przypięty do AKTUALNEGO rozmiaru robi jedno i drugie naraz: dzisiejszy stan przechodzi,
  // ale KAŻDA nowa linia kodu wywala bramkę i wymusza rozmowę o podziale. Gdy plik będzie dzielony
  // na serio, ten wyjątek ma zniknąć razem z powodem, dla którego powstał — nie podnosić liczb.
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
];
