#!/usr/bin/env node
// Runs ONLY the local guard rules (`nf/*`) over this workspace, without type information, and
// asserts what a lint run alone cannot: every guard inspected at least `presence.minSites` sites
// (a renamed anchor reads zero and fails instead of passing over nothing) and every path its
// allowlist names exists (an exemption for a deleted file exempts nothing).
//
// Usage:  node eslint-rules/run-guards.mjs            whole workspace, with floors (audit suite)
//         node eslint-rules/run-guards.mjs <files…>   only those files, no floors (pre-commit)
//
// Why a separate runner when `eslint .` already runs these rules: the push gate lints only the
// files of the push, and the full `eslint .` takes a minute because of typed rules. This runner
// parses without a type checker (seconds) and is what `tests/audit` calls for the whole tree.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import workspaceConfig from '../eslint.config.mjs';
import { GUARDS, guardConfigs } from './index.mjs';
import { readSites, resetSites } from './lib.mjs';

const WORKSPACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = process.argv.slice(2);
const measured = files.length === 0;

let failed = false;
const fail = message => {
  failed = true;
  console.error(`✗ ${message}`);
};

for (const guard of GUARDS) {
  for (const rel of guard.paths ?? []) {
    if (!existsSync(path.join(WORKSPACE, rel))) {
      fail(`nf/${guard.name}: path named by the rule does not exist: ${rel}`);
    }
  }
}

// Global ignores of the real config (blocks that hold nothing but `ignores`), so this run and
// `eslint .` agree on which files exist.
const globalIgnores = workspaceConfig.filter(
  block => block && Object.keys(block).length === 1 && Array.isArray(block.ignores)
);

const eslint = new ESLint({
  cwd: WORKSPACE,
  overrideConfigFile: true,
  errorOnUnmatchedPattern: !measured,
  overrideConfig: [
    ...globalIgnores,
    { linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' } },
    {
      files: ['**/*.{ts,mts,cts}'],
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      },
    },
    {
      files: ['**/*.tsx'],
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
      },
    },
    ...guardConfigs,
  ],
});

resetSites();
const results = await eslint.lintFiles(measured ? ['.'] : files);
const errors = results.flatMap(result =>
  result.messages
    .filter(message => message.severity === 2)
    .map(message => ({ file: path.relative(WORKSPACE, result.filePath), message }))
);

for (const { file, message } of errors) {
  const where = `${file}:${message.line ?? 0}:${message.column ?? 0}`;
  fail(`${where}  ${message.ruleId ?? 'parse'}  ${message.message}`);
}

const sites = readSites();
const lines = [];
for (const guard of GUARDS) {
  const count = sites.get(guard.name) ?? 0;
  lines.push(`  nf/${guard.name.padEnd(34)} ${String(count).padStart(6)} sites  (${guard.presence.what})`);
  if (measured && count < guard.presence.minSites) {
    fail(
      `nf/${guard.name}: inspected ${count} sites, floor is ${guard.presence.minSites} (${guard.presence.what}). The anchor moved or the root is wrong.`
    );
  }
}

console.log(`Guard rules in ${path.basename(WORKSPACE)}: ${GUARDS.length}, files linted: ${results.length}`);
console.log(lines.join('\n'));
if (failed) {
  console.error(`✗ LINT GUARDS FAILED (${path.basename(WORKSPACE)}): ${errors.length} finding(s)`);
  process.exit(1);
}
console.log(`✓ lint guards passed (${path.basename(WORKSPACE)})`);
