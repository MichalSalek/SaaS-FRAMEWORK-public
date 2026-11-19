// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import guard from './secret-discipline.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester();
const dir = mkdtempSync(path.join(tmpdir(), 'nf-secret-'));
const schema = path.join(dir, 'env-schema.ts');
writeFileSync(
  schema,
  [
    "// name: 'COMMENTED_SECRET' is prose, not a registration",
    'export const ENV_SCHEMA = [',
    "  { name: 'INTERNAL_SHARED_SECRET', required: 'prod', format: 'secret' },",
    '  {',
    "    name: 'STRIPE_WEBHOOK_SECRET',",
    "    required: 'prod',",
    '  },',
    '];',
  ].join('\n')
);
const options = [
  {
    envSchema: schema,
    compareAllow: ['src/application/auth/verify-internal-secret.ts'],
  },
];
const at = (code, filename = 'src/domain/x/sample.ts') => ({
  code,
  filename,
  options,
});
const compare = [{ messageId: 'compare' }];
const ungoverned = [{ messageId: 'ungoverned' }];

tester.run('nf/secret-discipline', guard.rule, {
  valid: [
    // the sanctioned constant-time compare
    at(
      'if (!verifyInternalSecret(provided, ENV_VARS.INTERNAL_SHARED_SECRET)) { deny(); }'
    ),
    // presence and type checks are not value compares
    at("if (typeof providedSecret !== 'string') { deny(); }"),
    at('if (clientSecret != null) { use(clientSecret); }'),
    at('if (session.client_secret == null) { fail(); }'),
    at(
      "if (secret === undefined || secret === '' || webhookSecret !== null) { fail(); }"
    ),
    at('if (secret === ``) { fail(); }'),
    // a compare of something derived from a secret name but not the secret itself
    at('if (secret.length === 32) { ok(); }'),
    // the allowlisted timing-safe module
    at(
      'if (a === secret) { ok(); }',
      'src/application/auth/verify-internal-secret.ts'
    ),
    // registered secrets read from process.env
    at(
      'export const RAW = { X: process.env.INTERNAL_SHARED_SECRET, Y: process.env.STRIPE_WEBHOOK_SECRET };'
    ),
    // non-secret env reads
    at("if (process.env.NEXT_RUNTIME === 'nodejs') { run(); }"),
    // prose and strings never count
    at('// if (secret === provided) {}\nconst a = 1;'),
    at(
      "const s = 'secret === provided'; const t = `process.env.UNKNOWN_SECRET`;"
    ),
  ],
  invalid: [
    // (a) the old shape: secret on the left
    { ...at('if (secret === provided) { ok(); }'), errors: compare },
    { ...at('if (webhookSecret !== header) { deny(); }'), errors: compare },
    {
      ...at('if (ENV_VARS.INTERNAL_SHARED_SECRET === header) { ok(); }'),
      errors: compare,
    },
    // stronger than the grep: secret on the right, loose equality, typeof elsewhere on the line
    { ...at('if (header === expectedSecret) { ok(); }'), errors: compare },
    { ...at('if (header != cfg.secret) { deny(); }'), errors: compare },
    {
      ...at("if (typeof secret === 'string' && secret === provided) { ok(); }"),
      errors: compare,
    },
    // (b) ungoverned secrets, every read form
    { ...at('const k = process.env.UNKNOWN_SECRET;'), errors: ungoverned },
    { ...at("const k = process.env['OTHER_SECRET_KEY'];"), errors: ungoverned },
    { ...at('const { NEW_SECRET } = process.env;'), errors: ungoverned },
    { ...at('const k = process.env.my_secret;'), errors: ungoverned },
    { ...at('const k = process.env.COMMENTED_SECRET;'), errors: ungoverned },
    // a schema that cannot be read is a finding, not a silent pass
    {
      code: 'const k = process.env.ANY_SECRET;',
      filename: 'src/x.ts',
      options: [{ envSchema: path.join(dir, 'missing.ts') }],
      errors: [{ messageId: 'noSchema' }],
    },
  ],
});
