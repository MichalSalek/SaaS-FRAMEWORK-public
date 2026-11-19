import { describe, it, expect, vi } from 'vitest';
import type { Prisma } from '../../prisma/js-client';
import { LockOrderViolationError } from './lock-order';
import {
  lockActivePair,
  lockInOrder,
  lockStylistAccount,
  lockSupportThread,
  lockUserRow,
} from './lock-rows';
import {
  favoriteAddLockPlan,
  salonInvitationAttachLockPlan,
  visitWriteLockPlan,
} from './lock-plans';

type SqlLike = { sql?: string; strings?: readonly string[] };

const sqlText = (query: unknown): string => {
  const q = query as SqlLike;
  if (typeof q.sql === 'string') {
    return q.sql;
  }
  return Array.isArray(query) ? (query as string[]).join('?') : '';
};

// A fake interactive tx: records every statement (SQL text + bound values) and answers from `exists`.
const fakeTx = (
  exists: (sql: string, values: unknown[]) => boolean = () => true
) => {
  const statements: { sql: string; values: unknown[] }[] = [];
  const $queryRaw = vi.fn(async (query: unknown, ...rest: unknown[]) => {
    const sql = sqlText(query);
    const values =
      (query as { values?: unknown[] }).values !== undefined
        ? ((query as { values: unknown[] }).values ?? [])
        : rest;
    statements.push({ sql, values });
    return exists(sql, values)
      ? [{ id: 'row', account_id: 'row', locked: 1 }]
      : [];
  });
  const tx = { $queryRaw } as unknown as Prisma.TransactionClient;
  return { tx, statements };
};

describe('lockInOrder', () => {
  it('issues one statement per row in rank, then id order, whatever the input order', async () => {
    const { tx, statements } = fakeTx();
    await lockInOrder(tx, [
      { table: 'SupportThread', id: 'thr_1' },
      { table: 'StylistAccount', id: 'acc_b' },
      { table: 'User', id: 'usr_2' },
      { table: 'StylistAccount', id: 'acc_a' },
      { table: 'User', id: 'usr_1', mode: 'FOR KEY SHARE' },
    ]);
    expect(statements.map(s => s.values[0])).toEqual([
      'usr_1',
      'usr_2',
      'acc_a',
      'acc_b',
      'thr_1',
    ]);
    expect(statements[0]?.sql).toMatch(
      /FROM "users" WHERE "id" = .* FOR KEY SHARE/
    );
    expect(statements[2]?.sql).toMatch(
      /FROM "StylistAccount" WHERE "account_id" = .* FOR UPDATE/
    );
    expect(statements[4]?.sql).toMatch(/FROM "SupportThread"/);
  });

  it('binds ids as parameters, never into the SQL text', async () => {
    const { tx, statements } = fakeTx();
    await lockInOrder(tx, [{ table: 'User', id: "x' OR 1=1 --" }]);
    expect(statements[0]?.sql).not.toContain('OR 1=1');
    expect(statements[0]?.values).toEqual(["x' OR 1=1 --"]);
  });

  it('reports missing rows as not locked (null semantics of the single primitives)', async () => {
    const { tx } = fakeTx((_sql, values) => values[0] !== 'missing');
    const result = await lockInOrder(tx, [
      { table: 'User', id: 'missing' },
      { table: 'StylistAccount', id: 'present' },
    ]);
    expect(result.isLocked('User', 'missing')).toBe(false);
    expect(result.isLocked('StylistAccount', 'present')).toBe(true);
  });

  it('throws before the statement when it would lock below what the tx already holds', async () => {
    const { tx, statements } = fakeTx();
    await lockStylistAccount(tx, 'acc_1');
    await expect(
      lockInOrder(tx, [{ table: 'User', id: 'usr_1', mode: 'FOR KEY SHARE' }])
    ).rejects.toBeInstanceOf(LockOrderViolationError);
    expect(statements).toHaveLength(1);
  });
});

describe('single-row primitives report to the order checker', () => {
  it('User -> StylistAccount -> pair -> SupportThread passes', async () => {
    const { tx } = fakeTx();
    await lockUserRow(tx, 'usr');
    await lockStylistAccount(tx, 'acc');
    await lockActivePair(tx, 'usr', 'acc');
    await expect(lockSupportThread(tx, 'thr')).resolves.not.toBeNull();
  });

  it('a pair lock followed by the stylist row is rejected (the pre-fix visit shape)', async () => {
    const { tx } = fakeTx();
    await lockActivePair(tx, 'usr', 'acc');
    await expect(lockStylistAccount(tx, 'acc')).rejects.toBeInstanceOf(
      LockOrderViolationError
    );
  });

  it('lockUserRow keeps `{ id } | null`', async () => {
    const present = fakeTx();
    await expect(lockUserRow(present.tx, 'u')).resolves.toEqual(
      expect.objectContaining({ id: 'row' })
    );
    const missing = fakeTx(() => false);
    await expect(lockUserRow(missing.tx, 'u')).resolves.toBeNull();
  });
});

describe('lock plans are in canonical order and pre-acquire the FK parents', () => {
  it.each([
    ['favoriteAdd', favoriteAddLockPlan('usr', 'acc')],
    ['visitWrite', visitWriteLockPlan('usr', 'acc')],
    ['salonInvitationAttach', salonInvitationAttachLockPlan('usr', 'acc')],
  ])(
    '%s: users KEY SHARE first, then the StylistAccount',
    async (_name, plan) => {
      const { tx, statements } = fakeTx();
      await lockInOrder(tx, plan);
      expect(statements[0]?.sql).toMatch(/"users".*FOR KEY SHARE/);
      expect(statements[1]?.sql).toMatch(/"StylistAccount"/);
      // the pair (rank 30) may follow both, as in the visit write barrier
      await expect(lockActivePair(tx, 'usr', 'acc')).resolves.not.toBeNull();
    }
  );
});
