// @vitest-environment node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import guard from './lock-sql-in-lock-module.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester();
const options = [guard.blocks[0].options];
const SAMPLE = 'src/domain/fixture/sample.ts';
const LOCK_ROWS = 'src/application/db/lock-rows.ts';
const LOCK_ORDER = 'src/application/db/lock-order.ts';
const LOCK_PLANS = 'src/application/db/lock-plans.ts';
const at = (code, filename = SAMPLE) => ({ code, filename, options });
const lock = (code, clause, line, filename = SAMPLE) => ({
  ...at(code, filename),
  errors: [{ messageId: 'lock', data: { clause }, line }],
});

// The stubs every fixture of tests/audit/_fixtures/lock-discipline carried.
const LOCK_ROWS_STUB = [
  '// Stub of the canonical lock module (the guard asserts it exists and carries >= 6 lock clauses).',
  'export const a = `SELECT 1 FROM "users" WHERE "id" = $1 FOR UPDATE`;',
  'export const b = `SELECT 1 FROM "StylistAccount" WHERE "account_id" = $1 FOR UPDATE`;',
  'export const c = `SELECT 1 FROM "ClientStylistPair" WHERE "id" = $1 FOR UPDATE`;',
  'export const d = `SELECT 1 FROM "VisitRecord" WHERE "id" = $1 FOR UPDATE`;',
  'export const e = `SELECT 1 FROM "GalleryRecord" WHERE "gallery_record_id" = $1 FOR NO KEY UPDATE`;',
  'export const f = `SELECT 1 FROM "SupportThread" WHERE "id" = $1 FOR UPDATE`;',
].join('\n');
const LOCK_ORDER_STUB =
  "export const LOCK_MODES = ['FOR KEY SHARE', 'FOR SHARE', 'FOR NO KEY UPDATE', 'FOR UPDATE'] as const;";
const LOCK_PLANS_STUB =
  "export const plan = [{ table: 'User', id: 'u', mode: 'FOR KEY SHARE' }];";

tester.run('nf/lock-sql-in-lock-module', guard.rule, {
  valid: [
    // fixture stubs: the lock module, the mode definer, a plan naming a mode as data
    at(LOCK_ROWS_STUB, LOCK_ROWS),
    at(LOCK_ORDER_STUB, LOCK_ORDER),
    at(LOCK_PLANS_STUB, LOCK_PLANS),
    at("type LockMode = 'FOR UPDATE' | 'FOR SHARE';", LOCK_ORDER),
    // fixture must-pass/comments-and-regex
    at(
      [
        '// The pair is taken FOR UPDATE by lockActivePair; FOR NO KEY UPDATE on the record.',
        '/* A block comment: SELECT ... FOR',
        '   UPDATE, FOR KEY SHARE. */',
        'export const QUOTED = /["\']position["\']/; // regex with quotes must not open a string: FOR UPDATE',
        "export const label = 'locks are taken in order';",
      ].join('\n')
    ),
    // fixture must-pass/escape-with-reason
    at(
      '// lock-discipline-allow: bespoke lock on a table no primitive owns (fixture)\nexport const sql = `SELECT 1 FROM "Other" WHERE "id" = $1 FOR UPDATE`;'
    ),
    // fixture must-pass/mode-as-data
    at(
      [
        'declare const lockInOrder: (tx: unknown, targets: unknown[]) => Promise<void>;',
        'export const lockForRoleChange = (tx: unknown, id: string) =>',
        "  lockInOrder(tx, [{ table: 'User', id, mode: 'FOR NO KEY UPDATE' as const }]);",
        "export const plan = { table: 'User', id: 'u', mode: \"FOR KEY SHARE\" };",
      ].join('\n')
    ),
    // a mode typed as data in an interface member
    at("interface Target { mode: 'FOR UPDATE' }"),
    // escape 15 lines above still counts
    at(
      `// lock-discipline-allow: bespoke (window edge)\n${'\n'.repeat(14)}const s = 'SELECT 1 FOR UPDATE';`
    ),
    // not a clause: a hole between FOR and UPDATE, prose words
    at('const s = `SELECT 1 FOR ${x} UPDATE`;'),
    at("const s = 'wait FOR UPDATES to land'; const t = 'FORUPDATE';"),
  ],
  invalid: [
    // fixture must-fail samples, same messages as the .expect files
    {
      ...at(
        '// lock-discipline-allow:\nexport const sql = `SELECT 1 FROM "users" WHERE "id" = $1 FOR UPDATE`;'
      ),
      errors: [
        { messageId: 'bareEscape', line: 1 },
        { messageId: 'lock', line: 2 },
      ],
    },
    lock(
      'export const lock = async (tx: { $queryRaw: (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> }, id: string) =>\n  tx.$queryRaw`SELECT 1 FROM "users" WHERE "id" = ${id} FOR UPDATE`;',
      'FOR UPDATE',
      2
    ),
    lock(
      'declare const Prisma: { sql: (s: TemplateStringsArray, ...v: unknown[]) => unknown };\nexport const build = (id: string) => Prisma.sql`select 1 from "users" where "id" = ${id} for key share`;',
      'for key share',
      2
    ),
    lock(
      'export const sql =\n  \'SELECT 1 FROM "users" WHERE "id" = $1 \' + \'FOR UPDATE\';',
      'FOR UPDATE',
      2
    ),
    lock("export const strongest = 'FOR UPDATE';", 'FOR UPDATE', 1),
    lock(
      'export const lock = async (tx: { $queryRaw: (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> }, id: string) =>\n  tx.$queryRaw`\n    SELECT 1 FROM "users" WHERE "id" = ${id} FOR\n    UPDATE`;',
      'FOR UPDATE',
      3
    ),
    lock(
      'export const sql = `SELECT 1 FROM "GalleryRecord" WHERE "gallery_record_id" = $1 FOR NO KEY UPDATE`;',
      'FOR NO KEY UPDATE',
      1
    ),
    lock(
      'export const sql = `SELECT 1 FROM "users" WHERE "id" = $1 FOR UPDATE`;',
      'FOR UPDATE',
      1,
      'src/pages/api/lock.ts'
    ),
    lock(
      `${LOCK_PLANS_STUB}\nexport const sneaky = \`SELECT 1 FROM "users" WHERE "id" = $1 FOR UPDATE\`;`,
      'FOR UPDATE',
      2,
      LOCK_PLANS
    ),
    lock(
      'export const lock = (tx: { $queryRawUnsafe: (s: string, id: string) => Promise<unknown> }, id: string) =>\n  tx.$queryRawUnsafe(\'SELECT 1 FROM "SupportThread" WHERE "id" = $1 FOR SHARE\', id);',
      'FOR SHARE',
      2
    ),
    // stricter than the shell scanner: an escape in the cooked text, a regex literal
    lock("const s = 'SELECT 1 FOR\\nUPDATE';", 'FOR UPDATE', 1),
    lock('const r = /FOR SHARE/;', 'FOR SHARE', 1),
    // a mode literal glued to SQL in the mode definer is SQL, not data
    lock(
      'export const s = `SELECT 1 FOR UPDATE`;',
      'FOR UPDATE',
      1,
      LOCK_ORDER
    ),
    // a mode as the value of a property that is not `mode`
    lock("export const plan = { strength: 'FOR UPDATE' };", 'FOR UPDATE', 1),
    // escape 16 lines above is out of the window
    lock(
      `// lock-discipline-allow: too far\n${'\n'.repeat(15)}const s = 'SELECT 1 FOR UPDATE';`,
      'FOR UPDATE',
      17
    ),
    // a union of modes outside the definer: the old scanner rejected every member but the first
    {
      ...at("interface Target { mode?: 'FOR UPDATE' | 'FOR SHARE' }"),
      errors: [{ messageId: 'lock' }, { messageId: 'lock' }],
    },
    // the lock module below its floor (a gutted module)
    {
      ...at('export const a = `SELECT 1 FOR UPDATE`;', LOCK_ROWS),
      errors: [{ messageId: 'floor', data: { count: '1', floor: '6' } }],
    },
  ],
});

// fixture must-fail/missing-lock-module: existence of the lock module is asserted by run-guards
// through `paths`; prove the rule names it and that it exists today.
it('names the lock module and the mode definer in `paths`, and both exist', () => {
  const workspace = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
  );
  expect(guard.paths).toContain(LOCK_ROWS);
  expect(guard.paths).toContain(LOCK_ORDER);
  for (const rel of guard.paths) {
    expect(existsSync(path.join(workspace, rel)), rel).toBe(true);
  }
});
