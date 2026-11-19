// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterAll } from 'vitest';
import guard from './prisma-nested-sql.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-sql-import-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const fragments = path.join(dir, 'fragments.ts');
fs.writeFileSync(
  fragments,
  `
  export class Sql { values: unknown[] = []; strings: string[] = []; sql = ''; }
  export const clause = new Sql();
  export const ctes = (_at: Date): Sql => new Sql();
  export const scalar = (): string => 'value';
`
);
const sample = (name, query) => {
  const filename = path.join(dir, `${name}.ts`);
  const code = `import { ctes as ledger, clause, scalar } from './fragments';\n
declare const tx: { $queryRaw: unknown };\n${query}`;
  fs.writeFileSync(filename, code);
  const program = ts.createProgram([filename, fragments], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
  });
  return {
    filename,
    code,
    languageOptions: { parserOptions: { programs: [program] } },
  };
};
const tester = createRuleTester();
tester.run('nf/prisma-nested-sql imported typed fragments', guard.rule, {
  valid: [
    sample(
      'argument',
      'const query = ledger(new Date()); tx.$queryRaw(query);'
    ),
    sample('scalar', 'tx.$queryRaw`SELECT ${scalar()}`;'),
  ],
  invalid: [
    {
      ...sample(
        'imported-call',
        'tx.$queryRaw`WITH ${ledger(new Date())} SELECT 1`;'
      ),
      errors: [{ messageId: 'variable' }],
    },
    {
      ...sample('imported-value', 'tx.$queryRaw`SELECT 1 ${clause}`;'),
      errors: [{ messageId: 'variable' }],
    },
  ],
});
