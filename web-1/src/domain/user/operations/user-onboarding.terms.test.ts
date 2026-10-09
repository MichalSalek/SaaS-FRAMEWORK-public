/**
 * Terms acceptance is recorded by onboarding (owner 2026-09-24): only on an
 * explicit `true`, only while User.terms_accepted_at is empty (first acceptance
 * wins), inside the same transaction as the account write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tx, db } = vi.hoisted(() => {
  const tx = {
    clientAccount: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    user: { updateMany: vi.fn() },
  };
  const db = {
    use: {
      $transaction: vi.fn(
        async (run: (client: typeof tx) => Promise<unknown>) => run(tx)
      ),
    },
  };
  return { tx, db };
});

vi.mock('@app/db/db.client', () => ({ DB_CLIENT: db }));
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: vi.fn(),
}));
vi.mock('./reconcile-active-role.helper', () => ({
  reconcileActiveRole: vi.fn(async () => undefined),
}));
vi.mock('@domain/account/vanity-url.auto', () => ({
  assignAutoVanityUrl_IO: vi.fn(async () => undefined),
}));

import { onboardAsClient_IO } from './user-onboarding.operations';

describe('onboarding records terms acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.clientAccount.findUnique.mockResolvedValue(null);
    tx.clientAccount.create.mockResolvedValue({ client_account_id: 'ca_1' });
    tx.user.updateMany.mockResolvedValue({ count: 1 });
  });

  it('stamps the first acceptance only while the column is empty', async () => {
    const result = await onboardAsClient_IO({
      userId: 'usr_1',
      termsAccepted: true,
    });

    expect(result.success).toBe(true);
    expect(tx.user.updateMany).toHaveBeenCalledTimes(1);
    const [args] = tx.user.updateMany.mock.calls[0] as [
      { where: unknown; data: { terms_accepted_at: unknown } },
    ];
    expect(args.where).toEqual({ id: 'usr_1', terms_accepted_at: null });
    expect(args.data.terms_accepted_at).toBeInstanceOf(Date);
  });

  it('still stamps when a concurrent writer created the account (P2002 heal)', async () => {
    tx.clientAccount.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ client_account_id: 'ca_race' });
    tx.clientAccount.create.mockRejectedValueOnce({ code: 'P2002' });

    const result = await onboardAsClient_IO({
      userId: 'usr_1',
      termsAccepted: true,
    });

    expect(result).toEqual({
      success: true,
      data: { client_account_id: 'ca_race' },
    });
    expect(tx.user.updateMany).toHaveBeenCalledTimes(1);
  });

  it('records nothing without an explicit acceptance', async () => {
    await onboardAsClient_IO({ userId: 'usr_1' });
    await onboardAsClient_IO({ userId: 'usr_1', termsAccepted: false });

    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });
});
