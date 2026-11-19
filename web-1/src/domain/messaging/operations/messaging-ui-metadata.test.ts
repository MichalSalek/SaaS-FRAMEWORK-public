import { describe, expect, it, vi } from 'vitest';
import { __setDb } from '../../../test-utils/setup';
import {
  makeClientCurrentUser,
  makeStylistCurrentUser,
} from '../../../test-utils/fixtures';
import {
  getConversations_IO,
  getThread_IO,
} from './messaging-query.operations';

function pair(clientUserId: string, stylistAccountId: string, id = 'pair-1') {
  return {
    id,
    client_user_id: clientUserId,
    stylist_account_id: stylistAccountId,
    status: 'CONTACT',
    salon_origin_account_id: null,
    client_hidden_at: null,
    stylist_hidden_at: null,
    last_message_at: new Date('2026-11-10T12:00:00Z'),
    client_user: { name: '', email: 'hidden@example.com', is_active: true },
    stylist_account: {
      display_name: 'Stylistka',
      business_name: null,
      account_status: 'ACTIVE',
      created_by_user: { is_active: true, image: null, avatar_url: null },
    },
  };
}

describe('messaging identity and profile navigation metadata', () => {
  it('labels each side independently in a dual-role inbox', async () => {
    const currentUser = makeStylistCurrentUser();
    const stylistId = currentUser.stylist_account?.account_id;
    if (!stylistId) {
      throw new Error('Stylist fixture requires an account');
    }
    __setDb({
      clientStylistPair: {
        findMany: vi.fn(
          async ({ where }: { where: { client_user_id?: string } }) =>
            where.client_user_id
              ? [pair(currentUser.id, 'other-stylist', 'as-client')]
              : [pair('other-client', stylistId, 'as-stylist')]
        ),
      },
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { unread_count: 0, unread_conversation_count: 0 },
        ]),
    });
    const result = await getConversations_IO({ currentUser });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.conversations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pair_id: 'as-client',
          viewer_side: 'CLIENT',
        }),
        expect.objectContaining({
          pair_id: 'as-stylist',
          viewer_side: 'STYLIST',
          counterpart_name: '',
        }),
      ])
    );
  });

  it.each(['CONTACT', 'PENDING', 'ACTIVE', 'REVOKED'])(
    'provides the public stylist destination in a client %s thread',
    async status => {
      const currentUser = makeClientCurrentUser();
      __setDb({
        clientStylistPair: {
          findUnique: vi.fn(async () => ({
            ...pair(currentUser.id, 'public-stylist'),
            status,
          })),
        },
        stylistClientMessage: { findMany: vi.fn(async () => []) },
      });
      const result = await getThread_IO({ currentUser, pairId: 'pair-1' });
      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }
      expect(result.data.meta).toMatchObject({
        viewer_side: 'CLIENT',
        counterpart_stylist_id: 'public-stylist',
      });
      expect(result.data.meta).not.toHaveProperty('revoked_by');
      expect(result.data.meta).not.toHaveProperty('can_request_connection');
    }
  );

  it('does not offer a private client identifier as a public profile', async () => {
    const currentUser = makeStylistCurrentUser();
    const stylistId = currentUser.stylist_account?.account_id;
    if (!stylistId) {
      throw new Error('Stylist fixture requires an account');
    }
    __setDb({
      clientStylistPair: {
        findUnique: vi.fn(async () => pair('private-client', stylistId)),
      },
      stylistClientMessage: { findMany: vi.fn(async () => []) },
    });
    const result = await getThread_IO({ currentUser, pairId: 'pair-1' });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.meta).toMatchObject({
      viewer_side: 'STYLIST',
      counterpart_stylist_id: null,
      counterpart_name: '',
    });
  });
});
