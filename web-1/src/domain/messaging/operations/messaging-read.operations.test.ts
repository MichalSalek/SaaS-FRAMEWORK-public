import { describe, expect, it, vi } from 'vitest';
import { __setDb } from '../../../test-utils/setup';
import { makeClientCurrentUser } from '../../../test-utils/fixtures';
import type { Prisma } from '../../../prisma/js-client';
import { markRead_IO } from './messaging-read.operations';

type ReadPair = Prisma.ClientStylistPairGetPayload<{
  select: {
    id: true;
    client_user_id: true;
    stylist_account_id: true;
    last_message_at: true;
    client_last_read_at: true;
    stylist_last_read_at: true;
    client_user: { select: { is_active: true } };
    stylist_account: {
      select: {
        account_status: true;
        created_by_user: { select: { is_active: true } };
      };
    };
  };
}>;

const makeReadPair = (
  clientUserId: string,
  lastMessageAt: Date | null
): ReadPair => ({
  id: 'pair',
  client_user_id: clientUserId,
  stylist_account_id: 'stylist',
  last_message_at: lastMessageAt,
  client_last_read_at: null,
  stylist_last_read_at: null,
  client_user: { is_active: true },
  stylist_account: {
    account_status: 'ACTIVE',
    created_by_user: { is_active: true },
  },
});

describe('read through activity', () => {
  it('does not pre-read a first message when an empty contact is opened', async () => {
    const user = makeClientCurrentUser();
    const updateMany = vi.fn(async (_args: unknown) => ({ count: 1 }));
    __setDb({
      clientStylistPair: {
        findUnique: vi.fn(async () => makeReadPair(user.id, null)),
        updateMany,
      },
    });

    const result = await markRead_IO({
      currentUser: user,
      pairId: 'pair',
      readThrough: new Date('2099-01-01T00:00:00Z'),
    });

    expect(updateMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      data: { read_at: new Date(0) },
    });
  });

  it('writes the client watermark through the state displayed', async () => {
    const user = makeClientCurrentUser();
    const readThrough = new Date('2026-11-06T10:00:00Z');
    const later = new Date('2026-11-06T10:00:01Z');
    const updateMany = vi.fn(async (_args: unknown) => ({ count: 1 }));
    __setDb({
      clientStylistPair: {
        findUnique: vi.fn(async () => makeReadPair(user.id, later)),
        updateMany,
      },
    });
    const result = await markRead_IO({
      currentUser: user,
      pairId: 'pair',
      readThrough,
    });
    expect(result).toMatchObject({
      success: true,
      data: { read_at: readThrough },
    });
    // The PostgreSQL session-activity test checks the monotonic predicate against
    // persisted rows. Here we retain the distinct client-side field contract.
    expect(updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: 'pair' },
      data: { client_last_read_at: readThrough },
    });
  });
});
