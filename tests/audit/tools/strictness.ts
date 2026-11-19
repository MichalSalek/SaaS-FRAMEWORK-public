// strictness — no `any`, no non-null `!`, no `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`.
//
// Successor of tests/audit/typescript-strictness.sh. The rules are ESLint built-ins
// (`@typescript-eslint/no-explicit-any`, `no-non-null-assertion`, `ban-ts-comment`) that all three
// workspace configs switch on as errors, with `noInlineConfig`. Re-implementing them as `nf` rules
// would be a second copy. What a lint run alone does not prove, and this tool does:
//   1. COVERAGE. For every file under the roots (main/src, web-1/src, .shared-kernel, tests/), the
//      workspace's REAL ESLint config does not ignore it and resolves all three rules to `error`.
//      A per-file override or new global ignore fails here instead of silently narrowing the gate.
//   2. WHOLE-TREE MEASUREMENT. The three rules run (no type info, inline config off) over every
//      file under the roots, including those the workspace lint ignores (READONLY kernel copies,
//      the generated DTO file).
//   3. PRESENCE FLOOR on the number of files linted per root.
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ESLint as ESLintClass, Linter } from 'eslint';
import {
  assertPaths,
  newCheck,
  projectRoot,
  report,
  walk,
  type CheckResult,
  type MutableCheck,
} from './_lib';

export const RULES = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-non-null-assertion': 'error',
  '@typescript-eslint/ban-ts-comment': [
    'error',
    {
      'ts-expect-error': true,
      'ts-ignore': true,
      'ts-nocheck': true,
      'ts-check': false,
    },
  ],
} as const satisfies Linter.RulesRecord;

/** Options of ban-ts-comment that must be `true` (banned outright, not "allow with description"). */
const BANNED_DIRECTIVES = [
  'ts-expect-error',
  'ts-ignore',
  'ts-nocheck',
] as const;

export interface Scope {
  /** Workspace directory relative to the repo root ('.' = root config). */
  readonly workspace: string;
  /** Scan root relative to the repo root. */
  readonly root: string;
  readonly minFiles: number;
  /**
   * Path prefixes (repo-relative) linted by THIS tool but ignored by the workspace config on
   * purpose; each needs a reason. They are measured, not coverage-checked.
   */
  readonly measuredOnly: readonly {
    readonly prefix: string;
    readonly reason: string;
  }[];
  /** Path prefixes outside the rule entirely (repo-relative). */
  readonly exclude: readonly string[];
}

// Measured 2026-10-23 (.ts/.tsx files under each root, READONLY copies included): main/src 1691,
// web-1/src 1309, .shared-kernel 185, tests 116.
export const SCOPES: readonly Scope[] = [
  {
    workspace: 'main',
    root: 'main/src',
    minFiles: 1400,
    measuredOnly: [
      {
        prefix: 'main/src/READONLY-shared-kernel/',
        reason:
          'generated copy of .shared-kernel (cp-kernel, chmod 444); the source is coverage-checked at the root',
      },
    ],
    exclude: [],
  },
  {
    workspace: 'web-1',
    root: 'web-1/src',
    minFiles: 1100,
    measuredOnly: [
      {
        prefix: 'web-1/src/READONLY-shared-kernel/',
        reason:
          'generated copy of .shared-kernel (cp-kernel, chmod 444); the source is coverage-checked at the root',
      },
    ],
    exclude: [],
  },
  {
    workspace: '.',
    root: '.shared-kernel',
    minFiles: 150,
    measuredOnly: [
      {
        prefix: '.shared-kernel/models/db_models.generated.dto.ts',
        reason:
          'generator output kept out of the root lint (prettier would break the byte parity dto-completeness checks)',
      },
    ],
    exclude: [],
  },
  {
    workspace: '.',
    root: 'tests',
    minFiles: 90,
    measuredOnly: [],
    exclude: ['tests/audit/_fixtures/'],
  },
];

const isTsSource = (rel: string): boolean =>
  (rel.endsWith('.ts') || rel.endsWith('.tsx')) && !rel.includes('/js-client/');

type ESLintCtor = typeof ESLintClass;

async function loadEslint(repoRoot: string): Promise<{
  ESLint: ESLintCtor;
  parser: Linter.Parser;
  plugin: ESLintClass.Plugin;
}> {
  const require = createRequire(path.join(repoRoot, 'package.json'));
  const eslintMod = (await import(
    pathToFileURL(require.resolve('eslint')).href
  )) as {
    ESLint: ESLintCtor;
  };
  const tsMod = (await import(
    pathToFileURL(require.resolve('typescript-eslint')).href
  )) as {
    default: { parser: Linter.Parser; plugin: ESLintClass.Plugin };
  };
  return {
    ESLint: eslintMod.ESLint,
    parser: tsMod.default.parser,
    plugin: tsMod.default.plugin,
  };
}

function severityOf(entry: unknown): number {
  const level: unknown = Array.isArray(entry) ? entry[0] : entry;
  if (level === 'error' || level === 2) {
    return 2;
  }
  if (level === 'warn' || level === 1) {
    return 1;
  }
  return 0;
}

/** Why the resolved config does not enforce the three rules on this file, or null when it does. */
export function coverageGap(
  rules: Partial<Linter.RulesRecord> | undefined
): string | null {
  const gaps: string[] = [];
  for (const rule of Object.keys(RULES)) {
    if (severityOf(rules?.[rule]) !== 2) {
      gaps.push(`${rule} is not 'error'`);
    }
  }
  const ban: unknown = rules?.['@typescript-eslint/ban-ts-comment'];
  const options: unknown = Array.isArray(ban) ? ban[1] : undefined;
  for (const directive of BANNED_DIRECTIVES) {
    const value: unknown =
      options !== null && typeof options === 'object'
        ? (options as Record<string, unknown>)[directive]
        : undefined;
    if (value !== true) {
      gaps.push(`ban-ts-comment does not ban @${directive} outright`);
    }
  }
  return gaps.length > 0 ? gaps.join('; ') : null;
}

export async function run(
  root: string,
  scopes: readonly Scope[] = SCOPES
): Promise<CheckResult[]> {
  const { ESLint, parser, plugin } = await loadEslint(projectRoot());
  const results: CheckResult[] = [];

  const measurer = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    ignore: false,
    overrideConfig: [
      {
        linterOptions: {
          noInlineConfig: true,
          reportUnusedDisableDirectives: 'off',
        },
        plugins: { '@typescript-eslint': plugin },
      },
      {
        files: ['**/*.ts'],
        languageOptions: {
          parser,
          parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        },
        rules: RULES,
      },
      {
        files: ['**/*.tsx'],
        languageOptions: {
          parser,
          parserOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            ecmaFeatures: { jsx: true },
          },
        },
        rules: RULES,
      },
    ],
  });

  for (const scope of scopes) {
    const check: MutableCheck = newCheck(
      `strictness:${scope.root}`,
      scope.minFiles,
      `.ts/.tsx files under ${scope.root}`
    );
    results.push(check);
    const configFile = path.join(scope.workspace, 'eslint.config.mjs');
    assertPaths(check, root, [scope.root, configFile, ...scope.exclude]);
    for (const entry of scope.measuredOnly) {
      assertPaths(check, root, [entry.prefix]);
    }
    if (check.errors.length > 0) {
      continue;
    }
    const files = walk(
      root,
      scope.root,
      rel => isTsSource(rel) && !scope.exclude.some(p => rel.startsWith(p))
    );
    check.sites = files.length;

    // 1. coverage by the workspace's real config
    const wsDir = path.join(root, scope.workspace);
    const real = new ESLint({
      cwd: wsDir,
      overrideConfigFile: path.join(root, configFile),
    });
    for (const rel of files) {
      if (scope.measuredOnly.some(entry => rel.startsWith(entry.prefix))) {
        continue;
      }
      const abs = path.join(root, rel);
      if (await real.isPathIgnored(abs)) {
        check.findings.push({
          file: rel,
          line: 1,
          message: `ignored by ${configFile}: no-any / no-non-null / ban-ts-comment never run on it`,
        });
        continue;
      }
      const config = (await real.calculateConfigForFile(abs)) as
        { rules?: Linter.RulesRecord } | undefined;
      const gap = coverageGap(config?.rules);
      if (gap !== null) {
        check.findings.push({
          file: rel,
          line: 1,
          message: `${configFile}: ${gap}`,
        });
      }
    }

    // 2. whole-tree measurement
    const linted = await measurer.lintFiles(
      files.map(rel => path.join(root, rel))
    );
    for (const result of linted) {
      for (const message of result.messages) {
        if (message.severity !== 2) {
          continue;
        }
        check.findings.push({
          file: path.relative(root, result.filePath).split(path.sep).join('/'),
          line: message.line,
          message: `${message.ruleId ?? 'parse error'}: ${message.message}`,
        });
      }
    }
  }
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(report('strictness', await run(projectRoot())));
}
