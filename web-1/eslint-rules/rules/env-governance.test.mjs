// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';
import guard from './env-governance.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester();
const file = '/w/src/domain/gallery/operations/x.operations.ts';
const allow = [
  { allow: ['src/application/environment/environment.config.ts'] },
];
const raw = [{ messageId: 'raw' }];

// Mini workspaces for the RAW_VARS <-> ENV_SCHEMA parity (the rule reads the sibling from disk).
const CONFIG = 'src/application/environment/environment.config.ts';
const SCHEMA = 'src/application/environment/env-schema.ts';
const configCode = names =>
  `const RAW_VARS = {\n${names.map(n => `  ${n}: normalizeString(process.env.${n}),`).join('\n')}\n} as const;\nexport const ENV_VARS = RAW_VARS;\n`;
const schemaCode = names =>
  `export const ENV_SCHEMA: readonly EnvVarSpec[] = [\n${names.map(n => `  { name: '${n}', required: 'always', format: 'string' },`).join('\n')}\n];\n`;
const roots = [];
function workspace(configNames, schemaNames) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nf-env-governance-'));
  roots.push(root);
  mkdirSync(path.join(root, 'src/application/environment'), {
    recursive: true,
  });
  if (configNames)
    writeFileSync(path.join(root, CONFIG), configCode(configNames));
  if (schemaNames)
    writeFileSync(path.join(root, SCHEMA), schemaCode(schemaNames));
  return root;
}
afterAll(() =>
  roots.forEach(root => rmSync(root, { recursive: true, force: true }))
);

const inSync = workspace(['A', 'B'], ['A', 'B']);
const schemaHasB = workspace(['A'], ['A', 'B']);
const configHasB = workspace(['A', 'B'], ['A']);

tester.run('nf/env-governance', guard.rule, {
  valid: [
    {
      filename: file,
      code: "const dev = process.env.NODE_ENV === 'development';",
    },
    {
      filename: file,
      code: "const edge = process.env.NEXT_RUNTIME === 'edge' || process.env.VERCEL === '1';",
    },
    { filename: file, code: 'const flag = process.env?.PPID;' },
    {
      filename: file,
      code: "import { ENV_VARS } from '@app/environment/environment.config';\nconst k = ENV_VARS.DATABASE_URL;",
    },
    // whole-env forwarding to a child process
    { filename: file, code: "const childEnv = { ...process.env, RUN: '1' };" },
    {
      filename: file,
      code: "const hasProcess = typeof process.env === 'object';",
    },
    { filename: file, code: 'const { NODE_ENV } = process.env;' },
    // a local variable named process is not the global
    {
      filename: file,
      code: 'function f(process: { env: { X: string } }) { return process.env.X; }',
    },
    // prose
    {
      filename: file,
      code: '// process.env.SECRET\n/* process.env.SECRET */\nconst s = "process.env.SECRET";\nconst t = `process.env.SECRET`;',
    },
    // the registry file is allowlisted for reads; parity in sync
    {
      filename: path.join(inSync, CONFIG),
      code: configCode(['A', 'B']),
      options: allow,
    },
    {
      filename: path.join(inSync, SCHEMA),
      code: schemaCode(['A', 'B']),
      options: allow,
    },
  ],
  invalid: [
    { filename: file, code: 'const k = process.env.STRIPE_KEY;', errors: raw },
    {
      filename: file,
      code: 'const k = process.env.lowercase_name;',
      errors: raw,
    },
    {
      filename: file,
      code: "const k = process.env['STRIPE_KEY'];",
      errors: raw,
    },
    {
      filename: file,
      code: "const k = process['env'].STRIPE_KEY;",
      errors: raw,
    },
    { filename: file, code: 'const k = process.env?.STRIPE_KEY;', errors: raw },
    {
      filename: file,
      code: 'const k = globalThis.process.env.STRIPE_KEY;',
      errors: raw,
    },
    { filename: file, code: "process.env.STRIPE_KEY = 'x';", errors: raw },
    {
      filename: file,
      code: 'const k = (name: string) => process.env[name];',
      errors: [{ messageId: 'dynamic' }],
    },
    // aliases
    {
      filename: file,
      code: 'const { env } = process;\nconst k = env.STRIPE_KEY;',
      errors: raw,
    },
    {
      filename: file,
      code: 'const { env: e } = process;\nconst k = e.STRIPE_KEY;',
      errors: raw,
    },
    {
      filename: file,
      code: 'const e = process.env;\nconst k = e.STRIPE_KEY;',
      errors: raw,
    },
    {
      filename: file,
      code: 'const p = process;\nconst k = p.env.STRIPE_KEY;',
      errors: raw,
    },
    {
      filename: file,
      code: 'const { STRIPE_KEY } = process.env;',
      errors: raw,
    },
    {
      filename: file,
      code: 'const { ...all } = process.env;',
      errors: [{ messageId: 'escape' }],
    },
    {
      filename: file,
      code: "import { env } from 'node:process';\nconst k = env.STRIPE_KEY;",
      errors: raw,
    },
    {
      filename: file,
      code: "import proc from 'process';\nconst k = proc.env.STRIPE_KEY;",
      errors: raw,
    },
    {
      filename: file,
      code: 'configure(process.env);',
      errors: [{ messageId: 'escape' }],
    },
    // env-schema.ts is not exempt for app vars any more
    {
      filename: path.join(inSync, SCHEMA),
      code: schemaCode(['A', 'B']) + 'const x = process.env.A;\n',
      options: allow,
      errors: raw,
    },
    // parity drift, reported once in the file that has the name
    {
      filename: path.join(schemaHasB, SCHEMA),
      code: schemaCode(['A', 'B']),
      options: allow,
      errors: [{ messageId: 'orphaned' }],
    },
    {
      filename: path.join(configHasB, CONFIG),
      code: configCode(['A', 'B']),
      options: allow,
      errors: [{ messageId: 'ungoverned' }],
    },
    // anchors
    {
      filename: path.join(inSync, CONFIG),
      code: 'export const ENV_VARS = {};',
      options: allow,
      errors: [{ messageId: 'anchor' }],
    },
    {
      filename: path.join(workspace(['A'], null), CONFIG),
      code: configCode(['A']),
      options: allow,
      errors: [{ messageId: 'anchor' }],
    },
  ],
});
