import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../../prisma/js-client';

const mocks = vi.hoisted(() => ({
  lock: vi.fn(
    async (_tx: unknown, _id: string): Promise<{ id: string } | null> => ({
      id: 'user',
    })
  ),
  defaultFind: vi.fn(),
}));
vi.mock('@app/db/lock-rows', () => ({ lockUserRow: mocks.lock }));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: { use: { stylistAccount: { findUnique: mocks.defaultFind } } },
}));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));
import { findAccountByCustomerId } from './stripe-webhooks.db';

const oldAccount = {
  account_id: 'account',
  created_by_user_id: 'user',
  pricing_plan: 'FREE',
  subscription_id: 'sub_old',
};
const newAccount = {
  ...oldAccount,
  pricing_plan: 'PRO',
  subscription_id: 'sub_new',
};
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { promise, release };
};

describe('Stripe account snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('re-reads after waiting for the owner lock, returning the new subscription and plan', async () => {
    const entered = gate();
    const release = gate();
    mocks.lock.mockImplementationOnce(async () => {
      entered.release();
      await release.promise;
      return { id: 'user' };
    });
    const find = vi
      .fn()
      .mockResolvedValueOnce(oldAccount)
      .mockResolvedValueOnce(newAccount);
    const tx = {
      stylistAccount: { findUnique: find },
    } as unknown as Prisma.TransactionClient;
    const pending = findAccountByCustomerId('cus_1', tx);
    await entered.promise;
    expect(find).toHaveBeenCalledTimes(1);
    release.release();
    expect(await pending).toEqual(newAccount);
    expect(mocks.lock).toHaveBeenCalledWith(tx, 'user');
    expect(find).toHaveBeenCalledTimes(2);
  });
  it('does not return an account if its owner disappears or changes while waiting', async () => {
    const find = vi
      .fn()
      .mockResolvedValueOnce(oldAccount)
      .mockResolvedValueOnce({ ...newAccount, created_by_user_id: 'other' });
    const tx = {
      stylistAccount: { findUnique: find },
    } as unknown as Prisma.TransactionClient;
    expect(await findAccountByCustomerId('cus_1', tx)).toBeNull();
    mocks.lock.mockResolvedValueOnce(null);
    find.mockResolvedValueOnce(oldAccount);
    expect(await findAccountByCustomerId('cus_1', tx)).toBeNull();
    find.mockResolvedValueOnce(oldAccount).mockResolvedValueOnce(null);
    expect(await findAccountByCustomerId('cus_1', tx)).toBeNull();
  });
  it('keeps the legacy no-transaction lookup to one best-effort read', async () => {
    mocks.defaultFind.mockResolvedValueOnce(oldAccount);
    expect(await findAccountByCustomerId('cus_1')).toEqual(oldAccount);
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.defaultFind).toHaveBeenCalledTimes(1);
  });
});
