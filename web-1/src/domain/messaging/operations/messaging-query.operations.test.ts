import { describe, expect, it, vi } from 'vitest';
import { __setDb } from '../../../test-utils/setup';
import {
  makeClientCurrentUser,
  makeStylistCurrentUser,
} from '../../../test-utils/fixtures';
import {
  AccountStatusValue,
  PairingStatusValue,
} from '@kernel/models/db_models.generated.dto';
import {
  getConversations_IO,
  getThread_IO,
} from './messaging-query.operations';

describe('getConversations_IO query count', () => {
  it('loads preview and unread aggregates for the full page in one SQL query', async () => {
    const currentUser = makeClientCurrentUser();
    const pairId = 'pair_test_000000000000001';
    const aggregateQuery = vi.fn(async () => [
      {
        pair_id: pairId,
        last_message_content: 'Ostatnia wiadomość',
        unread_count: 3,
      },
    ]);
    const findMany = vi.fn(
      async (args: { where: { client_user_id?: string } }) =>
        args.where.client_user_id
          ? [
              {
                id: pairId,
                status: PairingStatusValue.ACTIVE,
                last_message_at: new Date('2026-07-19T12:00:00.000Z'),
                client_last_read_at: null,
                stylist_last_read_at: null,
                client_user_id: currentUser.id,
                stylist_account_id: 'acc_test_0000000000000001',
                client_user: {
                  name: 'Klientka',
                  email: 'client@example.com',
                  is_active: true,
                },
                stylist_account: {
                  display_name: 'Salon',
                  business_name: null,
                  avatar_url: null,
                },
              },
            ]
          : []
    );

    __setDb({
      clientStylistPair: { findMany },
      $queryRaw: aggregateQuery,
    });

    const result = await getConversations_IO({ currentUser });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(aggregateQuery).toHaveBeenCalledTimes(1);
    expect(result.data.conversations[0]).toMatchObject({
      pair_id: pairId,
      last_message_preview: 'Ostatnia wiadomość',
      unread_count: 3,
    });
    expect(result.data.conversations[0]?.can_send).toBe(true);
  });
});

type FindManyArgs = {
  where: {
    client_user_id?: string;
    stylist_account_id?: string;
    client_hidden_at?: unknown;
    stylist_hidden_at?: unknown;
  };
};

const mockConversationsDb = (
  currentUserId: string,
  pairOver: {
    client_hidden_at?: Date | null;
    stylist_hidden_at?: Date | null;
  } = {}
) => {
  const pairId = 'pair_test_000000000000001';
  const hiddenAt = pairOver.client_hidden_at ?? null;
  const findMany = vi.fn(async (args: FindManyArgs) =>
    args.where.client_user_id
      ? [
          {
            id: pairId,
            status: PairingStatusValue.ACTIVE,
            last_message_at: new Date('2026-07-19T12:00:00.000Z'),
            client_last_read_at: null,
            stylist_last_read_at: null,
            client_hidden_at: hiddenAt,
            stylist_hidden_at: pairOver.stylist_hidden_at ?? null,
            client_user_id: currentUserId,
            stylist_account_id: 'acc_test_0000000000000001',
            client_user: {
              name: 'Klientka',
              email: 'client@example.com',
              is_active: true,
            },
            stylist_account: {
              display_name: 'Salon',
              business_name: null,
              avatar_url: null,
            },
          },
        ]
      : []
  );
  __setDb({
    clientStylistPair: { findMany },
    $queryRaw: vi.fn(async () => [
      {
        pair_id: pairId,
        last_message_content: 'Ostatnia wiadomość',
        unread_count: 0,
      },
    ]),
  });
  return { findMany, pairId };
};

describe('getConversations_IO — hidden filter (D2)', () => {
  it('default → both where objects contain client_hidden_at/stylist_hidden_at: null; items expose hidden_at', async () => {
    const currentUser = makeStylistCurrentUser();
    const { findMany, pairId } = mockConversationsDb(currentUser.id);

    const result = await getConversations_IO({ currentUser });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(findMany).toHaveBeenCalledTimes(2);
    const clientWhere = findMany.mock.calls.find(
      call => call[0]?.where.client_user_id !== undefined
    )?.[0]?.where;
    const stylistWhere = findMany.mock.calls.find(
      call => call[0]?.where.stylist_account_id !== undefined
    )?.[0]?.where;
    expect(clientWhere).toMatchObject({ client_hidden_at: null });
    expect(stylistWhere).toMatchObject({ stylist_hidden_at: null });
    expect(result.data.conversations[0]).toMatchObject({
      pair_id: pairId,
      hidden_at: null,
    });
  });

  it('hidden:true → {not:null} on both branches; items expose hidden_at', async () => {
    const currentUser = makeStylistCurrentUser();
    const hiddenAt = new Date('2026-08-01T00:00:00.000Z');
    const { findMany, pairId } = mockConversationsDb(currentUser.id, {
      client_hidden_at: hiddenAt,
    });

    const result = await getConversations_IO({
      currentUser,
      hidden: true,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    const clientWhere = findMany.mock.calls.find(
      call => call[0]?.where.client_user_id !== undefined
    )?.[0]?.where;
    const stylistWhere = findMany.mock.calls.find(
      call => call[0]?.where.stylist_account_id !== undefined
    )?.[0]?.where;
    expect(clientWhere).toMatchObject({
      client_hidden_at: { not: null },
    });
    expect(stylistWhere).toMatchObject({
      stylist_hidden_at: { not: null },
    });
    expect(result.data.conversations[0]).toMatchObject({
      pair_id: pairId,
      hidden_at: hiddenAt,
    });
  });
});

describe('getThread_IO — meta.hidden_at is viewer-side', () => {
  it('client sees client_hidden_at (not stylist_hidden_at)', async () => {
    const currentUser = makeClientCurrentUser();
    const clientHidden = new Date('2026-09-01T00:00:00.000Z');
    const stylistHidden = new Date('2026-08-01T00:00:00.000Z');
    const pairId = 'pair_test_000000000000001';
    __setDb({
      clientStylistPair: {
        findUnique: vi.fn(async () => ({
          id: pairId,
          client_user_id: currentUser.id,
          stylist_account_id: 'acc_test_0000000000000001',
          status: PairingStatusValue.ACTIVE,
          client_hidden_at: clientHidden,
          stylist_hidden_at: stylistHidden,
          client_user: {
            name: 'Klientka',
            email: 'client@example.com',
            is_active: true,
          },
          stylist_account: {
            display_name: 'Salon',
            business_name: null,
            avatar_url: null,
            account_status: AccountStatusValue.ACTIVE,
          },
        })),
      },
      stylistClientMessage: {
        findMany: vi.fn(async () => []),
      },
    });

    const result = await getThread_IO({ currentUser, pairId });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.meta.hidden_at).toBe(clientHidden);
  });
});
