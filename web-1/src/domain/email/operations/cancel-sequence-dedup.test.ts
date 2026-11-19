import { describe, expect, it, vi } from 'vitest';
import { __setDb } from '../../../test-utils/setup';
import { resolveCancelSequenceDue_IO } from './cancel-sequence.operation';

describe('cancel sequence audit deduplication', () => {
  it('does not omit a sent rule when another user has duplicate audit rows', async () => {
    const now = new Date('2026-11-07T12:00:00Z');
    const anchor = new Date('2026-11-06T12:00:00Z');
    const raw = [
      ...Array.from({ length: 6 }, () => ({
        created_by_user_id: 'a',
        event: 'EMAIL_CANCEL_D1_SENT',
      })),
      { created_by_user_id: 'b', event: 'EMAIL_CANCEL_D1_SENT' },
    ];
    const findMany = vi.fn(
      async (args: { where: { event_type: string }; take: number }) =>
        args.where.event_type === 'ACCOUNT'
          ? ['a', 'b'].map(id => ({
              created_by_user_id: id,
              created_at: anchor,
              event_payload: {
                newPricingPlan: 'FREE',
                oldPricingPlan: 'PRO',
                source: 'stripe',
              },
            }))
          : raw.slice(0, args.take)
    );
    const groupBy = vi.fn(async () => [raw[0], raw[6]]);
    const accountFind = vi.fn(async () => []);
    __setDb({
      eventLog: { findMany, groupBy },
      stylistAccount: { findMany: accountFind },
    });
    const result = await resolveCancelSequenceDue_IO(now);
    expect(result.ready).toEqual([]);
    expect(accountFind).not.toHaveBeenCalled();
    expect(groupBy).toHaveBeenCalledOnce();
  });
});
