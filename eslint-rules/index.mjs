// Local guard rules (`nf/*`) for this workspace: the AST successors of the grep audits in
// `tests/audit`. `rules/_*.mjs` are helpers shared by rules,
// not rules.
//
// DECISION: rules are DISCOVERED from `rules/*.mjs`, never listed by hand. A hand-kept list is the
// failure shape the audit doctrine names first (a list rots as files appear). Each rule module
// exports its own config blocks (`files` root, options, allowlist), its presence floor and the
// paths its allowlist names; `run-guards.mjs` asserts all three, and `index.test.mjs` fails on a
// rule without blocks, without a floor or without a RuleTester suite. Rule names are unique per
// module, so the flat-config "a later block replaces the rule" trap of `no-restricted-syntax`
// cannot hit them.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Paths through `fileURLToPath`, not `new URL(rel, import.meta.url)`: Vite (Vitest) rewrites that
// form as an asset import and refuses files outside the workspace.
const RULES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'rules'
);

const ruleFiles = readdirSync(RULES_DIR)
  .filter(
    file =>
      file.endsWith('.mjs') &&
      !file.endsWith('.test.mjs') &&
      !file.startsWith('_')
  )
  .sort();

/**
 * @typedef {object} GuardBlock
 * @property {string[]} files      root globs, relative to the workspace
 * @property {string[]} [ignores]
 * @property {unknown}  [options]  rule options for this block (allowlists live here)
 *
 * @typedef {object} GuardDefinition
 * @property {string} name                       rule id without the `nf/` prefix
 * @property {import('eslint').Rule.RuleModule} rule
 * @property {GuardBlock[]} blocks
 * @property {{ minSites: number, what: string }} presence  floor on inspected sites
 * @property {string[]} [paths]                  every path literal the rule or its blocks name
 * @property {string} [replaces]                 the retired tests/audit script, for the record
 */

/** @type {GuardDefinition[]} */
export const GUARDS = await Promise.all(
  ruleFiles.map(async file => {
    const mod = await import(pathToFileURL(path.join(RULES_DIR, file)).href);
    const def = mod.default;
    if (!def || `${def.name}.mjs` !== file) {
      throw new Error(
        `eslint-rules/rules/${file}: default export must be a guard definition named after the file`
      );
    }
    return def;
  })
);

export const plugin = {
  meta: { name: 'nf' },
  rules: Object.fromEntries(GUARDS.map(guard => [guard.name, guard.rule])),
};

/** Flat-config blocks that switch every guard on for its own root. */
export const guardConfigs = GUARDS.flatMap(guard =>
  guard.blocks.map(block => ({
    files: block.files,
    ...(block.ignores ? { ignores: block.ignores } : {}),
    plugins: { nf: plugin },
    rules: {
      [`nf/${guard.name}`]:
        block.options === undefined ? 'error' : ['error', block.options],
    },
  }))
);
