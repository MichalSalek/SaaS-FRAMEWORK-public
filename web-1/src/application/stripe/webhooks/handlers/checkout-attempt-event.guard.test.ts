import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../../../prisma/js-client';

const { lockUserRow } = vi.hoisted(() => ({
  lockUserRow: vi.fn(async () => ({ id: 'user' })),
}));
vi.mock('@app/db/lock-rows', () => ({
  lockUserRow,
  acquireAdvisoryXactLock: vi.fn(),
}));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));
vi.mock('@app/stripe/webhooks/stripe-webhooks.utils', () => ({
  buildCriticalAlertEffect: () => async () => undefined,
}));
vi.mock('@app/stripe/webhooks/stripe-webhooks.db', () => ({
  findAccountByCustomerId: vi.fn(),
}));
import { acceptsCheckoutAttempt } from './checkout-attempt-event.guard';

const current = {
  attempt_id: 'current',
  phase: 'preparing',
  stripe_session_id: null as string | null,
  stripe_subscription_id: null as string | null,
};
let rows: Array<typeof current>;
const query = vi.fn(async (_strings: TemplateStringsArray) => rows);
const account = vi.fn(async () => ({ subscription_id: 'sub_old' }));
const tx = {
  $queryRaw: query,
  stylistAccount: { findUnique: account },
} as unknown as Prisma.TransactionClient;
const run = (
  overrides: Partial<Parameters<typeof acceptsCheckoutAttempt>[0]> = {}
) =>
  acceptsCheckoutAttempt({
    tx,
    userId: 'user',
    accountId: 'account',
    attemptId: 'current',
    sessionId: 'cs_current',
    ...overrides,
  });

describe('checkout event generation fence', () => {
  beforeEach(() => {
    rows = [{ ...current }];
    query.mockClear();
    account.mockClear();
    lockUserRow.mockClear();
  });
  it('locks the user before the attempt and accepts the first completion before the session id is stored', async () => {
    expect(await run()).toBe(true);
    expect(lockUserRow.mock.invocationCallOrder[0]).toBeLessThan(
      query.mock.invocationCallOrder[0] ?? 0
    );
    expect(query.mock.calls[0]?.[0].join('')).toContain('FOR SHARE');
  });
  it('requires the current generation and a matching stored session', async () => {
    expect(await run({ attemptId: 'old' })).toBe(false);
    rows = [{ ...current, stripe_session_id: 'different' }];
    expect(await run()).toBe(false);
    rows = [{ ...current, stripe_session_id: 'cs_current' }];
    expect(await run()).toBe(true);
    rows = [{ ...current, phase: 'expired' }];
    expect(await run()).toBe(false);
    rows = [];
    expect(await run()).toBe(false);
  });
  it('never allows an older tagged lifecycle event even if its subscription is still the account pointer', async () => {
    const runSubscription = (subscriptionId: string) =>
      acceptsCheckoutAttempt({
        tx,
        userId: 'user',
        accountId: 'account',
        attemptId: 'old',
        subscriptionEvent: true,
        subscriptionId,
      });
    expect(await runSubscription('sub_old')).toBe(false);
    expect(account).not.toHaveBeenCalled();
    rows = [];
    expect(await runSubscription('sub_old')).toBe(true);
    expect(await runSubscription('other')).toBe(false);
  });
  it('fails closed without a transaction and propagates lookup errors for retry', async () => {
    await expect(run({ tx: undefined })).rejects.toThrow(
      'requires a database transaction'
    );
    query.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(run()).rejects.toThrow('database unavailable');
  });
});
