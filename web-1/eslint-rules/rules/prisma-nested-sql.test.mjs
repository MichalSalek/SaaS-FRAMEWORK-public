// @vitest-environment node
import guard from './prisma-nested-sql.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester();

// The fixtures of tests/audit/_fixtures/prisma-nested-sql, verbatim (same verdicts).
const FIXTURE = {
  'must-fail/escape-empty-reason.ts':
    '// An escape marker with no reason is itself a violation: an exception nobody had\n// to justify is how a ratchet rots into decoration.\n// Fixture standalone (bez importów): każda próbka jest kopiowana pojedynczo do\n// mini-projektu selftestu, a tsconfig testów i tak kompiluje ten katalog.\ndeclare namespace Prisma {\n  type Sql = { readonly __sql: \'Sql\' };\n  type TransactionClient = {\n    $queryRaw: <T>(query: TemplateStringsArray | Sql, ...values: unknown[]) => Promise<T>;\n    $executeRaw: (query: TemplateStringsArray | Sql, ...values: unknown[]) => Promise<number>;\n  };\n}\ndeclare const Prisma: {\n  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Prisma.Sql;\n  empty: Prisma.Sql;\n  join: (values: unknown[]) => Prisma.Sql;\n};\n\nexport const countLikes = async (tx: Prisma.TransactionClient, onlyPublic: boolean) => {\n  const clause = onlyPublic ? Prisma.sql`AND "is_public" = true` : Prisma.empty;\n  // prisma-nested-sql-allow:\n  return tx.$queryRaw<Array<{ n: bigint }>>`\n    SELECT count(*) AS n FROM "GalleryRecord" WHERE 1 = 1 ${clause}`;\n};\n',
  'must-fail/executeraw-join-and-typed-param.ts':
    '// Dwie pozostałe drogi, którymi fragment wchodzi do tagowanego szablonu:\n// `$executeRaw` (nie tylko `$queryRaw`) z `Prisma.join`, oraz PARAMETR\n// anotowany `Prisma.Sql` w szablonie z zagnieżdżonym generykiem.\n// Fixture standalone (bez importów): każda próbka jest kopiowana pojedynczo do\n// mini-projektu selftestu, a tsconfig testów i tak kompiluje ten katalog.\ndeclare namespace Prisma {\n  type Sql = { readonly __sql: \'Sql\' };\n  type TransactionClient = {\n    $queryRaw: <T>(query: TemplateStringsArray | Sql, ...values: unknown[]) => Promise<T>;\n    $executeRaw: (query: TemplateStringsArray | Sql, ...values: unknown[]) => Promise<number>;\n  };\n}\ndeclare const Prisma: {\n  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Prisma.Sql;\n  empty: Prisma.Sql;\n  join: (values: unknown[]) => Prisma.Sql;\n};\n\nexport const purge = async (tx: Prisma.TransactionClient, ids: string[]) => {\n  const inClause = Prisma.join(ids);\n  return tx.$executeRaw`DELETE FROM "GalleryRecord" WHERE "id" IN (${inClause})`;\n};\n\nexport const countBy = async (tx: Prisma.TransactionClient, clause: Prisma.Sql) =>\n  tx.$queryRaw<Array<{ date: Date; count: bigint }>>`\n    SELECT now() AS date, count(*) AS count FROM "GalleryRecord" WHERE 1 = 1 ${clause}`;\n',
  'must-fail/inline-literal-empty.ts':
    '// Literal nested fragment straight in the tagged template — same breakage, and\n// the shape a naive grep WOULD catch. Kept so both branches stay covered.\n// Fixture standalone (bez importów): każda próbka jest kopiowana pojedynczo do\n// mini-projektu selftestu, a tsconfig testów i tak kompiluje ten katalog.\ndeclare namespace Prisma {\n  type Sql = { readonly __sql: \'Sql\' };\n  type TransactionClient = {\n    $queryRaw: <T>(query: TemplateStringsArray | Sql, ...values: unknown[]) => Promise<T>;\n    $executeRaw: (query: TemplateStringsArray | Sql, ...values: unknown[]) => Promise<number>;\n  };\n}\ndeclare const Prisma: {\n  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Prisma.Sql;\n  empty: Prisma.Sql;\n  join: (values: unknown[]) => Prisma.Sql;\n};\n\nexport const countLikes = async (tx: Prisma.TransactionClient, onlyPublic: boolean) =>\n  tx.$queryRaw<Array<{ n: bigint }>>`\n    SELECT count(*) AS n FROM "GalleryRecord"\n     WHERE 1 = 1 ${onlyPublic ? Prisma.sql`AND "is_public" = true` : Prisma.empty}`;\n',
  'must-fail/lock-rows-prefix.ts':
    '// RED-first proof: the EXACT pre-fix shape of lockActivePair (lock-rows.ts) that\n// shipped a 500 to production. The fragment is a VARIABLE, not a literal\n// `Prisma.sql` between the backticks — a literal-only grep reports green here.\n// Fixture standalone (bez importów): każda próbka jest kopiowana pojedynczo do\n// mini-projektu selftestu, a tsconfig testów i tak kompiluje ten katalog.\ndeclare namespace Prisma {\n  type Sql = { readonly __sql: \'Sql\' };\n  type TransactionClient = {\n    $queryRaw: <T>(query: TemplateStringsArray | Sql, ...values: unknown[]) => Promise<T>;\n    $executeRaw: (query: TemplateStringsArray | Sql, ...values: unknown[]) => Promise<number>;\n  };\n}\ndeclare const Prisma: {\n  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Prisma.Sql;\n  empty: Prisma.Sql;\n  join: (values: unknown[]) => Prisma.Sql;\n};\n\nexport const lockActivePair = async (\n  tx: Prisma.TransactionClient,\n  clientUserId: string,\n  stylistAccountId: string,\n  { requireActiveClient = false }: { requireActiveClient?: boolean } = {}\n): Promise<Array<{ id: string }>> => {\n  const activeClientClause = requireActiveClient\n    ? Prisma.sql`AND EXISTS (\n         SELECT 1 FROM "users" u\n          WHERE u."id" = "ClientStylistPair"."client_user_id"\n            AND u."is_active" = true\n       )`\n    : Prisma.empty;\n\n  return tx.$queryRaw<Array<{ id: string }>>`\n    SELECT "id"\n      FROM "ClientStylistPair"\n     WHERE "client_user_id" = ${clientUserId}\n       AND "stylist_account_id" = ${stylistAccountId}\n       AND "status"::text = \'ACTIVE\'\n       ${activeClientClause}\n     FOR UPDATE`;\n};\n',
  'must-pass/argument-form.ts':
    '// THE FIX: whole query built with Prisma.sql, finished object passed as an\n// ARGUMENT. Flattening happens in THIS module, so both sides of `instanceof Sql`\n// come from one copy of sql-template-tag and Prisma receives one flat Sql.\n// Fixture standalone (bez importów): każda próbka jest kopiowana pojedynczo do\n// mini-projektu selftestu, a tsconfig testów i tak kompiluje ten katalog.\ndeclare namespace Prisma {\n  type Sql = { readonly __sql: \'Sql\' };\n  type TransactionClient = {\n    $queryRaw: <T>(query: TemplateStringsArray | Sql, ...values: unknown[]) => Promise<T>;\n    $executeRaw: (query: TemplateStringsArray | Sql, ...values: unknown[]) => Promise<number>;\n  };\n}\ndeclare const Prisma: {\n  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Prisma.Sql;\n  empty: Prisma.Sql;\n  join: (values: unknown[]) => Prisma.Sql;\n};\n\nexport const lockActivePair = async (\n  tx: Prisma.TransactionClient,\n  clientUserId: string,\n  requireActiveClient: boolean\n): Promise<Array<{ id: string }>> => {\n  const activeClientClause = requireActiveClient\n    ? Prisma.sql`AND "client_is_active" = true`\n    : Prisma.empty;\n\n  const query = Prisma.sql`\n    SELECT "id" FROM "ClientStylistPair"\n     WHERE "client_user_id" = ${clientUserId}\n       ${activeClientClause}\n     FOR UPDATE`;\n  return tx.$queryRaw<Array<{ id: string }>>(query);\n};\n',
  'must-pass/comment-describes-broken-form.ts':
    '// Fixture standalone (bez importów): każda próbka jest kopiowana pojedynczo do\n// mini-projektu selftestu, a tsconfig testów i tak kompiluje ten katalog.\ndeclare namespace Prisma {\n  type Sql = { readonly __sql: \'Sql\' };\n  type TransactionClient = {\n    $queryRaw: <T>(query: TemplateStringsArray | Sql, ...values: unknown[]) => Promise<T>;\n    $executeRaw: (query: TemplateStringsArray | Sql, ...values: unknown[]) => Promise<number>;\n  };\n}\ndeclare const Prisma: {\n  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Prisma.Sql;\n  empty: Prisma.Sql;\n  join: (values: unknown[]) => Prisma.Sql;\n};\n\n/**\n * Comment-awareness proof. lock-rows.ts carries a DECISION block that spells the\n * BROKEN form out verbatim so the next agent does not reinvent it:\n *\n *   const activeClientClause = cond ? Prisma.sql`AND x = 1` : Prisma.empty;\n *   await tx.$queryRaw`SELECT … ${activeClientClause} FOR UPDATE`;\n *\n * A guard that fires on prose describing the pattern makes rephrasing the\n * documentation the "fix" — this repo has paid that three times already.\n */\nexport const listPairs = async (tx: Prisma.TransactionClient, ids: string[]) =>\n  tx.$queryRaw<Array<{ id: string }>>(\n    Prisma.sql`SELECT "id" FROM "ClientStylistPair" WHERE "id" IN (${Prisma.join(ids)})`\n  );\n',
  'must-pass/escape-with-reason.ts':
    '// A justified escape suppresses the finding (and only the finding on its own\n// template) — the documented exception mechanism of this repo.\n// Fixture standalone (bez importów): każda próbka jest kopiowana pojedynczo do\n// mini-projektu selftestu, a tsconfig testów i tak kompiluje ten katalog.\ndeclare namespace Prisma {\n  type Sql = { readonly __sql: \'Sql\' };\n  type TransactionClient = {\n    $queryRaw: <T>(query: TemplateStringsArray | Sql, ...values: unknown[]) => Promise<T>;\n    $executeRaw: (query: TemplateStringsArray | Sql, ...values: unknown[]) => Promise<number>;\n  };\n}\ndeclare const Prisma: {\n  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Prisma.Sql;\n  empty: Prisma.Sql;\n  join: (values: unknown[]) => Prisma.Sql;\n};\n\nexport const countLikes = async (tx: Prisma.TransactionClient, onlyPublic: boolean) => {\n  const clause = onlyPublic ? Prisma.sql`AND "is_public" = true` : Prisma.empty;\n  // prisma-nested-sql-allow: sample proving the escape branch of the guard\n  return tx.$queryRaw<Array<{ n: bigint }>>`\n    SELECT count(*) AS n FROM "GalleryRecord" WHERE 1 = 1 ${clause}`;\n};\n',
  'must-pass/plain-values.ts':
    '// Ordinary VALUE interpolation in a tagged template is exactly what tagged\n// templates are for (bind parameters, injection-safe) — must stay untouched,\n// otherwise the guard would ban the 90+ healthy raw call sites in this repo.\n// Fixture standalone (bez importów): każda próbka jest kopiowana pojedynczo do\n// mini-projektu selftestu, a tsconfig testów i tak kompiluje ten katalog.\ndeclare namespace Prisma {\n  type Sql = { readonly __sql: \'Sql\' };\n  type TransactionClient = {\n    $queryRaw: <T>(query: TemplateStringsArray | Sql, ...values: unknown[]) => Promise<T>;\n    $executeRaw: (query: TemplateStringsArray | Sql, ...values: unknown[]) => Promise<number>;\n  };\n}\ndeclare const Prisma: {\n  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Prisma.Sql;\n  empty: Prisma.Sql;\n  join: (values: unknown[]) => Prisma.Sql;\n};\n\nexport const lockUserRow = async (tx: Prisma.TransactionClient, userId: string, key: string) => {\n  await tx.$queryRaw`SELECT pg_advisory_xact_lock((\'x\' || substr(md5(${key}), 1, 16))::bit(64)::bigint)::text AS locked`;\n  const rows = await tx.$queryRaw<Array<{ id: string }>>`\n    SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;\n  return rows[0] ?? null;\n};\n',
};

const PRELUDE = FIXTURE['must-pass/plain-values.ts'].split('export const')[0];
const at = code => `${PRELUDE}${code}`;
const lit = [{ messageId: 'literal' }];
const vari = [{ messageId: 'variable' }];

tester.run('nf/prisma-nested-sql', guard.rule, {
  valid: [
    FIXTURE['must-pass/argument-form.ts'],
    FIXTURE['must-pass/comment-describes-broken-form.ts'],
    FIXTURE['must-pass/escape-with-reason.ts'],
    FIXTURE['must-pass/plain-values.ts'],
    // prose and strings never count
    at('// tx.$queryRaw`SELECT ${Prisma.empty}`\nexport const a = 1;'),
    at("export const s = 'tx.$queryRaw`SELECT ${Prisma.empty}`';"),
    at("export const t = `tx.$queryRaw SELECT ${'Prisma.empty'}`;"),
    // the argument form with a fragment variable
    at(
      'export const f = (tx: Prisma.TransactionClient, c: Prisma.Sql) => tx.$queryRaw(Prisma.sql`SELECT 1 ${c}`);'
    ),
    // a value variable
    at(
      'export const f = (tx: Prisma.TransactionClient, id: string) => { const v = id.trim(); return tx.$executeRaw`DELETE FROM x WHERE id = ${v}`; };'
    ),
  ],
  invalid: [
    {
      code: FIXTURE['must-fail/escape-empty-reason.ts'],
      errors: [{ messageId: 'bareEscape' }, { messageId: 'variable' }],
    },
    {
      code: FIXTURE['must-fail/executeraw-join-and-typed-param.ts'],
      errors: [
        { messageId: 'variable', data: { expr: 'inClause' } },
        { messageId: 'variable', data: { expr: 'clause' } },
      ],
    },
    { code: FIXTURE['must-fail/inline-literal-empty.ts'], errors: lit },
    {
      code: FIXTURE['must-fail/lock-rows-prefix.ts'],
      errors: [{ messageId: 'variable', data: { expr: 'activeClientClause' } }],
    },
    // a builder declared in the file, and an arrow const typed to return a fragment (new)
    {
      code: at(
        'function build(on: boolean): Prisma.Sql { return on ? Prisma.sql`AND x` : Prisma.empty; }\nexport const f = (tx: Prisma.TransactionClient) => tx.$queryRaw`SELECT 1 ${build(true)}`;'
      ),
      errors: vari,
    },
    {
      code: at(
        'const build = (): Prisma.Sql => make();\nexport const f = (tx: Prisma.TransactionClient) => tx.$queryRaw`SELECT 1 ${build()}`;'
      ),
      errors: vari,
    },
    // a member typed Prisma.Sql read through an object
    {
      code: at(
        'export const f = (tx: Prisma.TransactionClient, o: { clause: Prisma.Sql }) => tx.$queryRaw`SELECT 1 ${o.clause}`;'
      ),
      errors: vari,
    },
    // new: an alias of a fragment variable (the shell scanner saw only literal initialisers)
    {
      code: at(
        'export const f = (tx: Prisma.TransactionClient) => { const c = Prisma.empty; const d = c; return tx.$queryRaw`SELECT 1 ${d}`; };'
      ),
      errors: vari,
    },
    // $executeRaw with a literal join
    {
      code: at(
        'export const f = (tx: Prisma.TransactionClient) => tx.$executeRaw`DELETE FROM x WHERE id IN (${Prisma.join([1, 2])})`;'
      ),
      errors: lit,
    },
    // escape on a line far above the template does not count
    {
      code: at(
        '// prisma-nested-sql-allow: too far\n\nexport const f = (tx: Prisma.TransactionClient) => tx.$queryRaw`SELECT 1 ${Prisma.empty}`;'
      ),
      errors: lit,
    },
  ],
});
