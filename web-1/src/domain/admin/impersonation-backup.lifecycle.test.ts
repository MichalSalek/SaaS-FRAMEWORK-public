/**
 * The impersonated session dies with its backup row (closing review s34).
 *
 * The sensitive-command gate and the audit stamp recognise impersonation by the
 * backup row. A session that outlives its row is an ungated, unstamped login on
 * the user's account, so both the switch-back claim and the expiry sweep delete
 * the session in the same transaction, before the row.
 */
import { describe, expect, it, vi } from 'vitest';

import { mockDb } from '../../test-utils/mockApiHandler';
import {
  claimImpersonationBackupByRefId,
  sweepExpiredImpersonationBackups,
} from './impersonation-backup.utils';

const install = (
  rows: { ref_id: string; impersonated_session_token: string }[]
) => {
  const calls: string[] = [];
  const sessionDeleteMany = vi.fn(async (_args: unknown) => {
    calls.push('session');
    return { count: 1 };
  });
  const backupDeleteMany = vi.fn(async (_args: unknown) => {
    calls.push('backup');
    return { count: rows.length };
  });
  mockDb({
    impersonationBackup: {
      findUnique: async (args: { where: { ref_id: string } }) =>
        rows.find(row => row.ref_id === args.where.ref_id) ?? null,
      findMany: async () => rows,
      deleteMany: backupDeleteMany,
    },
    session: { deleteMany: sessionDeleteMany },
  });
  return { calls, sessionDeleteMany, backupDeleteMany };
};

describe('impersonation backup lifecycle', () => {
  it('switch-back claim deletes the impersonated session BEFORE the row', async () => {
    const { calls, sessionDeleteMany } = install([
      { ref_id: 'ref_1', impersonated_session_token: 'tok_imp' },
    ]);
    await expect(claimImpersonationBackupByRefId('ref_1')).resolves.toBe(true);
    expect(sessionDeleteMany).toHaveBeenCalledWith({
      where: { token: 'tok_imp' },
    });
    expect(calls).toEqual(['session', 'backup']);
  });

  it('a claim for a missing row touches nothing', async () => {
    const { calls } = install([]);
    await expect(claimImpersonationBackupByRefId('gone')).resolves.toBe(false);
    expect(calls).toEqual([]);
  });

  it('the expiry sweep takes every expired impersonated session with it', async () => {
    const { calls, sessionDeleteMany } = install([
      { ref_id: 'ref_1', impersonated_session_token: 'tok_a' },
      { ref_id: 'ref_2', impersonated_session_token: 'tok_b' },
    ]);
    await expect(sweepExpiredImpersonationBackups()).resolves.toEqual({
      deleted: 2,
    });
    expect(sessionDeleteMany).toHaveBeenCalledWith({
      where: { token: { in: ['tok_a', 'tok_b'] } },
    });
    expect(calls).toEqual(['session', 'backup']);
  });
});
