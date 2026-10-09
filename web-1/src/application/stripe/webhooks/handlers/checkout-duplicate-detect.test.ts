/**
 * detectDuplicateSubscription — when an OLD subscription may be retired (s34).
 * A session without a subscription replaced nothing, so nothing may be cancelled.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));
vi.mock('./checkout-auto-cancel.utils', () => ({
  autoCancelOldSubscription: vi.fn(async () => undefined),
}));

import { detectDuplicateSubscription } from './checkout.handler.utils';

const account = (subscription_id: string | null) =>
  ({
    account_id: 'acc_1',
    created_by_user_id: 'usr_1',
    subscription_id,
  }) as never;

const detect = (stored: string | null, incoming: string | undefined) =>
  detectDuplicateSubscription({
    account: account(stored),
    userEmail: 'u@example.pl',
    newSubscriptionId: incoming,
    session: { id: 'cs_1' } as never,
  });

describe('detectDuplicateSubscription', () => {
  it('stored sub replaced by a different one → cancel effect', () => {
    expect(detect('sub_old', 'sub_new')).toEqual(expect.any(Function));
  });

  it('session without a subscription → nothing to cancel', () => {
    expect(detect('sub_live', undefined)).toBeNull();
  });

  it('same subscription or none stored → nothing to cancel', () => {
    expect(detect('sub_1', 'sub_1')).toBeNull();
    expect(detect(null, 'sub_1')).toBeNull();
  });
});
