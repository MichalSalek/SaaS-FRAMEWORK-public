// Tests for tools/pagination.ts: temp mini trees under os.tmpdir().
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  checkSweepOrderBy,
  checkTiebreaker,
  EMAIL_ROOT,
  EMAIL_LIFECYCLE_ROOT,
} from './pagination';
import type { CheckResult } from './_lib';

const tmpRoots: string[] = [];
after(() => {
  for (const dir of tmpRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nf-pagination-'));
  tmpRoots.push(root);
  mkdirSync(path.join(root, EMAIL_ROOT), { recursive: true });
  mkdirSync(path.join(root, EMAIL_LIFECYCLE_ROOT), { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const DECL =
  'declare const db: { m: { findMany: (a: object) => Promise<unknown[]> } };\n';
const tb = (body: string): CheckResult =>
  checkTiebreaker(
    tree({ 'web-1/src/domain/x/list.operations.ts': `${DECL}${body}\n` })
  );

void describe('pagination:tiebreaker', () => {
  void it('rejects a single non-unique sort with skip, with cursor, and with a sort object value', () => {
    assert.equal(
      tb(
        "export const a = (s: number) => db.m.findMany({ skip: s, take: 20, orderBy: { created_at: 'desc' } });"
      ).findings.length,
      1
    );
    assert.equal(
      tb(
        "export const a = (c: object) => db.m.findMany({ cursor: c, take: 20, orderBy: { name: 'asc' } });"
      ).findings.length,
      1
    );
    assert.equal(
      tb(
        "export const a = (skip: number) => db.m.findMany({ skip, orderBy: { name: { sort: 'asc', nulls: 'last' } } });"
      ).findings.length,
      1
    );
  });

  void it('rejects a multi-line object and a variable direction (the one-line grep missed both)', () => {
    const c = tb(`export const a = (s: number, dir: 'asc' | 'desc') =>
  db.m.findMany({
    skip: s,
    orderBy: {
      created_at: dir,
    },
  });`);
    assert.equal(c.findings.length, 1);
    assert.equal(c.findings[0]?.line, 5);
  });

  void it('accepts the array form, a unique key, a top-N read and a single-row read', () => {
    const c =
      tb(`export const a = (s: number) => db.m.findMany({ skip: s, orderBy: [{ created_at: 'desc' }, { id: 'desc' }] });
export const b = (s: number) => db.m.findMany({ skip: s, orderBy: { id: 'desc' } });
export const c2 = (s: number) => db.m.findMany({ skip: s, orderBy: { user_id: 'desc' } });
export const e = () => db.m.findMany({ include: { messages: { orderBy: { created_at: 'desc' }, take: 1 } }, skip: 0 });`);
    assert.deepEqual(c.findings, []);
    assert.equal(c.sites, 4);
    // A top-N read with no skip:/cursor: in the 12-line window is not pagination.
    const top = tb(
      "export const d = () => db.m.findMany({ take: 10, orderBy: { created_at: 'desc' } });"
    );
    assert.deepEqual(top.findings, []);
  });

  void it('finds skip within 12 lines when the args are built apart (as before)', () => {
    const c = tb(`const sort = { orderBy: { created_at: 'desc' } };
export const a = (s: number) => db.m.findMany({ ...sort, skip: s });`);
    assert.equal(c.findings.length, 1);
  });

  void it('ignores prose: comments, strings and templates', () => {
    const c = tb(`// db.m.findMany({ skip: 1, orderBy: { created_at: 'desc' } })
/* orderBy: { created_at: 'desc' }, skip: 1 */
export const s = "orderBy: { created_at: 'desc' }, skip: 1";
export const t = \`orderBy: { created_at: 'desc' } \${s} cursor: x\`;`);
    assert.deepEqual(c.findings, []);
    assert.equal(c.sites, 0);
  });

  void it('skip: in a comment near a top-N sort does not make it paginated', () => {
    const c = tb(`// skip: handled by the caller
export const d = () => db.m.findMany({ take: 10, orderBy: { created_at: 'desc' } });`);
    assert.deepEqual(c.findings, []);
  });

  void it('accepts tiebreaker-allow with a reason, rejects a bare marker', () => {
    const ok = tb(`export const a = (s: number) => db.m.findMany({
  skip: s,
  // tiebreaker-allow: slug is @unique in schema.prisma
  orderBy: { slug: 'asc' },
});`);
    assert.deepEqual(ok.findings, []);
    const bare = tb(`export const a = (s: number) => db.m.findMany({
  skip: s,
  // tiebreaker-allow:
  orderBy: { slug: 'asc' },
});`);
    assert.match(bare.findings[0]?.message ?? '', /without a reason/);
  });
});

const sweep = (
  body: string,
  rel = `${EMAIL_ROOT}/operations/x.operation.ts`
): CheckResult => checkSweepOrderBy(tree({ [rel]: `${DECL}${body}\n` }));

void describe('pagination:sweep-orderby', () => {
  void it('rejects a capped selection without orderBy (literal, constant and shorthand caps)', () => {
    assert.equal(
      sweep(
        'export const a = () => db.m.findMany({ where: { payment_status: 1 }, take: 500 });'
      ).findings.length,
      1
    );
    assert.equal(
      sweep(
        'const CAP = 50;\nexport const a = () => db.m.findMany({ where: {}, take: CAP });'
      ).findings.length,
      1
    );
    assert.equal(
      sweep('export const a = (take: number) => db.m.findMany({ take });')
        .findings.length,
      1
    );
  });

  void it('covers every non-test file under the email root, not only *.operation.ts', () => {
    const c = sweep(
      'export const a = () => db.m.findMany({ take: 10 });',
      `${EMAIL_ROOT}/x/trial-sweep.query.ts`
    );
    assert.equal(c.findings.length, 1);
    const t = sweep(
      'export const a = () => db.m.findMany({ take: 10 });',
      `${EMAIL_ROOT}/x/a.operation.test.ts`
    );
    assert.equal(t.sites, 0);
  });

  void it('accepts orderBy and calls without take, and checks all capped lookups', () => {
    const c =
      sweep(`export const a = () => db.m.findMany({ where: {}, take: 500, orderBy: { createdAt: 'asc' } });
export const b = (ids: string[]) => db.m.findMany({ where: { id: { in: ids } }, take: ids.length });
export const c2 = (ids: string[]) => db.m.findMany({ take: Math.min(ids.length, 9) });
export const d = (ids: string[]) => db.m.findMany({ where: { userId: { in: ids } }, take: 100 });
export const e = () => db.m.findMany({ where: {} });`);
    assert.equal(c.findings.length, 3);
    assert.equal(c.sites, 5);
  });

  void it('an origin:/admin: key is not an in: lookup (the awk /in:/ exempted it)', () => {
    const c = sweep(
      "export const a = () => db.m.findMany({ where: { origin: 'x', admin: false }, take: 50 });"
    );
    assert.equal(c.findings.length, 1);
  });

  void it('ignores prose: comments, strings and templates', () => {
    const c = sweep(`// db.m.findMany({ take: 5 })
/* .findMany({ take: 5 }) */
export const s = '.findMany({ take: 5 })';
export const t = \`\${s}.findMany({ take: 5 })\`;
export const a = () => db.m.findMany({ take: 5, orderBy: { id: 'asc' } }); // no orderBy needed? orderBy present`);
    assert.deepEqual(c.findings, []);
    assert.equal(c.sites, 1);
  });

  void it('orderBy named only in a comment or string does not satisfy it', () => {
    const c = sweep(`export const a = () => db.m.findMany({
  // orderBy: { createdAt: 'asc' }
  where: { note: 'orderBy' },
  take: 50,
});`);
    assert.equal(c.findings.length, 1);
    assert.equal(c.findings[0]?.line, 5);
  });

  void it('accepts orderby-exempt with a reason inside the call, rejects a bare marker', () => {
    const ok = sweep(`export const a = () => db.m.findMany({
  // orderby-exempt: every row is processed in one pass
  take: 50,
});`);
    assert.deepEqual(ok.findings, []);
    const bare = sweep(`export const a = () => db.m.findMany({
  take: 50, // orderby-exempt:
});`);
    assert.match(bare.findings[0]?.message ?? '', /without a reason/);
  });

  void it('reports a missing email root', () => {
    const root = tree({});
    rmSync(path.join(root, EMAIL_ROOT), { recursive: true });
    assert.ok(checkSweepOrderBy(root).errors.length > 0);
  });
});

void it('does not exempt bounded multi-row IN lookups by key count', () => {
  for (const take of [
    '100',
    'userIds.length',
    'Math.min(userIds.length, 100)',
  ]) {
    const c = sweep(
      `export const a = (userIds: string[]) => db.eventLog.findMany({ where: { user_id: { in: userIds } }, take: ${take} });`
    );
    assert.equal(c.findings.length, 1, take);
  }
});

void it('covers capped selections moved into the lifecycle application layer', () => {
  const result = sweep(
    'export const a = () => db.m.findMany({ take: 50 });',
    'web-1/src/application/email-handler/lifecycle/frequency-window.ts'
  );
  assert.equal(result.findings.length, 1);
});
