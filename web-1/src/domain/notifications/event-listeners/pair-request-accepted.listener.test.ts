/**
 * An accepted request becomes a row for the client, with the stylist's
 * display name read on the spot.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';

type Handler = (payload: unknown) => Promise<void>;
const captured = vi.hoisted(() => new Map<string, Handler>());
const notifyUser_IO = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => undefined)
);

vi.mock('@app/events/event-bus', () => ({
  subscribeToInfoEvent: (event: string, handler: Handler) => {
    captured.set(event, handler);
    return () => undefined;
  },
}));
vi.mock('@domain/notifications/notify-user.service', () => ({
  notifyUser_IO,
}));

import './pair-request-accepted.listener';

beforeEach(() => {
  notifyUser_IO.mockClear();
});

describe('pair-request-accepted listener', () => {
  it('writes a CLIENT row keyed by the pair, named after the stylist, leading to her gallery', async () => {
    mockDb({
      stylistAccount: {
        findUnique: async () => ({
          display_name: 'Studio Ani',
          business_name: null,
          created_by_user: { name: 'Ania' },
        }),
      },
    });
    const handler = captured.get('PAIR_REQUEST_ACCEPTED');
    expect(handler).toBeDefined();
    await handler?.({
      pairId: 'pair_1',
      clientUserId: 'usr_client',
      stylistAccountId: 'acc_1',
      stylistUserId: 'usr_stylist',
    });
    expect(notifyUser_IO).toHaveBeenCalledTimes(1);
    expect(notifyUser_IO.mock.calls[0]?.[0]).toEqual({
      userId: 'usr_client',
      recipientRole: 'CLIENT',
      type: 'PAIR_REQUEST_ACCEPTED',
      dedupKey: 'PAIR_REQUEST_ACCEPTED:pair_1',
      actorUserId: 'usr_stylist',
      actorName: 'Studio Ani',
      targetPath: '/app/gallery/stylist/acc_1',
      rearm: true,
    });
  });

  it('a nameless stylist leaves actorName null (the copy table names the role)', async () => {
    mockDb({
      stylistAccount: {
        findUnique: async () => ({
          display_name: '  ',
          business_name: null,
          created_by_user: { name: '' },
        }),
      },
    });
    await captured.get('PAIR_REQUEST_ACCEPTED')?.({
      pairId: 'pair_2',
      clientUserId: 'usr_client',
      stylistAccountId: 'acc_2',
      stylistUserId: 'usr_stylist',
    });
    const input = notifyUser_IO.mock.calls[0]?.[0] as {
      actorName: string | null;
    };
    expect(input.actorName).toBeNull();
  });
});
