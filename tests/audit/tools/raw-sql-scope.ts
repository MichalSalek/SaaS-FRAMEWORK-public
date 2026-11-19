// raw-sql-scope — the two raw-SQL guards of web-1 also over the root `scripts/` and `.shared-kernel`.
//
// `nf/prisma-nested-sql` and `nf/lock-sql-in-lock-module` live in web-1/eslint-rules and lint
// web-1. Their retired shell scripts also scanned `scripts/**/*.ts` and `.shared-kernel/**/*.ts`
// (prisma-nested-sql both, lock-discipline the kernel through its READONLY copy). No ESLint config
// lints `scripts/`, so this tool runs the SAME rule modules, with web-1's ESLint and parser, over
// those two roots. Today both roots hold zero raw SQL; the
// floor is on files scanned, because a floor on SQL sites would demand SQL where none belongs.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

export const ROOTS = ['scripts', '.shared-kernel'] as const;
export const RULES = ['prisma-nested-sql', 'lock-sql-in-lock-module'] as const;
const RULE_DIR = 'web-1/eslint-rules/rules';
// Measured 2026-10-23: 8 .ts files under scripts/, about 190 under .shared-kernel.
export const MIN_FILES = 150;

const isScanned = (rel: string): boolean =>
  rel.endsWith('.ts') &&
  !rel.endsWith('.d.ts') &&
  !rel.includes('/node_modules/');

interface RuleModule {
  readonly default: {
    readonly rule: unknown;
    readonly blocks: readonly { readonly options?: unknown }[];
  };
}

/** Where the rule modules and web-1's ESLint are loaded from: this repository, not the scanned root. */
const IMPL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..'
);

export async function run(
  root: string,
  minFiles = MIN_FILES
): Promise<CheckResult[]> {
  const check: MutableCheck = newCheck(
    'raw-sql-scope',
    minFiles,
    '.ts files under scripts/ and .shared-kernel'
  );
  assertPaths(check, root, [...ROOTS]);
  assertPaths(check, IMPL_ROOT, [
    ...RULES.map(r => `${RULE_DIR}/${r}.mjs`),
    'web-1/package.json',
  ]);
  if (check.errors.length > 0) {
    return [check];
  }
  const files = ROOTS.flatMap(dir => walk(root, dir, isScanned));
  check.sites = files.length;
  if (files.length === 0) {
    return [check];
  }
  const requireWeb1 = createRequire(
    path.join(IMPL_ROOT, 'web-1', 'package.json')
  );
  const { ESLint } = requireWeb1('eslint') as { ESLint: typeof ESLintClass };
  const tseslint = requireWeb1('typescript-eslint') as {
    parser: Linter.Parser;
  };
  const rules: Record<string, unknown> = {};
  const ruleConfig: Linter.RulesRecord = {};
  for (const name of RULES) {
    const mod = (await import(
      pathToFileURL(path.join(IMPL_ROOT, RULE_DIR, `${name}.mjs`)).href
    )) as RuleModule;
    rules[name] = mod.default.rule;
    const options = mod.default.blocks[0]?.options;
    ruleConfig[`nf/${name}`] =
      options === undefined ? 'error' : ['error', options];
  }
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        },
        linterOptions: { noInlineConfig: true },
        plugins: { nf: { rules } as unknown as ESLintClass.Plugin },
        rules: ruleConfig,
      },
    ],
  });
  const results = await eslint.lintFiles(
    files.map(rel => path.join(root, rel))
  );
  for (const result of results) {
    for (const message of result.messages) {
      if (message.severity === 2) {
        check.findings.push({
          file: path.relative(root, result.filePath).split(path.sep).join('/'),
          line: message.line,
          message: `${message.ruleId ?? 'parse'}: ${message.message}`,
        });
      }
    }
  }
  return [check];
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exit(report('raw-sql-scope', await run(projectRoot())));
}
