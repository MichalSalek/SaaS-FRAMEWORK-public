import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { run } from './raw-sql-scope';

const roots: string[] = [];
after(() => {
  for (const dir of roots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nf-raw-sql-'));
  roots.push(root);
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  mkdirSync(path.join(root, '.shared-kernel'), { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const findings = async (files: Record<string, string>): Promise<string[]> => {
  const [check] = await run(tree(files), 1);
  assert.ok(check);
  assert.deepEqual(check.errors, []);
  return check.findings.map(f => `${f.file} ${f.message}`);
};

void describe('raw-sql-scope', () => {
  void it('rejects a nested Prisma.sql fragment in a tagged template under scripts/', async () => {
    const out = await findings({
      'scripts/db/report.ts':
        'declare const tx: any; declare const Prisma: any;\nconst where = Prisma.sql`a = 1`;\nexport const q = tx.$queryRaw`SELECT 1 WHERE ${where}`;\n',
    });
    assert.ok(
      out.some(m => m.includes('nf/prisma-nested-sql')),
      out.join('\n')
    );
  });
  void it('rejects row-lock SQL in the kernel', async () => {
    const out = await findings({
      '.shared-kernel/domain/x.ts':
        "export const sql = 'SELECT * FROM t FOR UPDATE';\n",
    });
    assert.ok(
      out.some(m => m.includes('nf/lock-sql-in-lock-module')),
      out.join('\n')
    );
  });
  void it('accepts code without raw SQL and prose that names it', async () => {
    assert.deepEqual(
      await findings({
        'scripts/a.ts':
          '// $queryRaw`${Prisma.sql`x`}` FOR UPDATE\nexport const a = 1;\n',
      }),
      []
    );
  });
  void it('fails the floor on an empty root', async () => {
    const [check] = await run(tree({}), 1);
    assert.ok(check && check.sites < check.minSites);
  });
});
