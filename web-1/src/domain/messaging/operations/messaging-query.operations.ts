import { resolvePersonAvatarUrl } from '@kernel/domain/user/avatar.policy';
import { resolveSalonAccess_IO } from '@domain/pairing/salon-access.resolver';
import { hydrateSessionActivityPreviews } from '@domain/session-container/session-activity.preview';
/**
 * Messaging read operations — getThread_IO, getConversations_IO.
 *
 * Oba party-gated (resolvePairSide). Wątek: cursor-paginacja (created_at,id)
 * scoped do pary (bez existence-oracle — cursor sprawdzany WHERE id+pair_id).
 * Lista rozmów: unia stron (client + stylist) filtrowana last_message_at cursorem,
 * unread liczony per para (druga strona, created_at > mój last_read_at).
 */
import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { success, failure } from '@kernel/application/result.types';
import type { OperationResult } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { MessagingError } from '@kernel/domain/messaging/messaging-errors.types';
import {
  StylistClientMessageSenderValue,
  type MessagingMessageDTO,
  type MessagingThreadMeta,
  type MessagingConversationDTO,
} from '@kernel/models/messaging/messaging.dto';
import { AccountStatusValue } from '@kernel/models/db_models.generated.dto';
import type { CurrentUser } from '@kernel/models/user/user.types';
import {
  resolvePairSide,
  canSendToPair,
  counterpartName,
  isCounterpartInactive,
} from '../messaging.helpers';
import { conversationCursorWhere } from './messaging-conversation-cursor.helpers';
import {
  previewOf,
  loadConversationAggregates,
  loadVisibleUnreadConversationCount,
} from './messaging-query.helpers';
const THREAD_PAGE = 50;
const CONVERSATIONS_PAGE = 50;
export const getThread_IO = async (params: {
  currentUser: CurrentUser;
  pairId: string;
  cursor?: string;
}): Promise<
  OperationResult<
    {
      meta: MessagingThreadMeta;
      messages: MessagingMessageDTO[];
      next_cursor: string | null;
      read_through: Date | null;
    },
    MessagingError | DatabaseError
  >
> => {
  const { currentUser, pairId, cursor } = params;
  try {
    const pair = await DB_CLIENT.use.clientStylistPair.findUnique({
      where: { id: pairId },
      select: {
        id: true,
        client_user_id: true,
        salon_origin_account_id: true,
        stylist_account_id: true,
        status: true,
        stylist_hidden_at: true,
        client_hidden_at: true,
        client_user: {
          select: {
            name: true,
            email: true,
            is_active: true,
            image: true,
            avatar_url: true,
          },
        },
        stylist_account: {
          select: {
            display_name: true,
            business_name: true,
            created_by_user: {
              select: { image: true, avatar_url: true, is_active: true },
            },
            account_status: true,
          },
        },
      },
    });
    if (pair == null) {
      return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
    }
    if (
      pair.status === 'ACTIVE' &&
      pair.salon_origin_account_id &&
      !(await resolveSalonAccess_IO(
        pair.client_user_id,
        pair.stylist_account_id
      ))
    ) {
      // Ordinary disconnect keeps conversation history readable for its parties.
      pair.status = 'REVOKED';
    }
    const side = resolvePairSide(pair, currentUser);
    if (side == null) {
      return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
    }
    // DECISION: see messaging-write.operations.ts (counterpart visibility mask); same verdict here, a
    // soft-deleted or disabled counterpart is MESSAGING_PAIR_NOT_FOUND on the live surface.
    const counterpartInactive = isCounterpartInactive(side, pair);
    if (counterpartInactive) {
      return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
    }
    // The cursor is scoped to the pair: the id must belong to this pair, which closes the existence oracle.
    let olderThan: {
      created_at: Date;
      id: string;
    } | null = null;
    if (cursor != null && cursor.length > 0) {
      const anchor = await DB_CLIENT.use.stylistClientMessage.findFirst({
        where: { id: cursor, pair_id: pairId },
        select: { created_at: true, id: true },
      });
      if (anchor != null) {
        olderThan = anchor;
      }
    }
    const rows = await DB_CLIENT.use.stylistClientMessage.findMany({
      where: {
        pair_id: pairId,
        ...(olderThan != null
          ? {
              OR: [
                { created_at: { lt: olderThan.created_at } },
                {
                  created_at: olderThan.created_at,
                  id: { lt: olderThan.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: THREAD_PAGE + 1,
      select: {
        id: true,
        sender_type: true,
        content: true,
        created_at: true,
        kind: true,
        session_id: true,
        change_scope: true,
        activity_at: true,
        revision: true,
      },
    });
    const hasMore = rows.length > THREAD_PAGE;
    const page = hasMore ? rows.slice(0, THREAD_PAGE) : rows;
    const next_cursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;
    // Do wyświetlenia: najstarsze→najnowsze (odwracamy DESC-page).
    const messages = await hydrateSessionActivityPreviews([...page].reverse(), {
      userId: currentUser.id,
      ...(currentUser.client_account?.client_account_id
        ? { clientAccountId: currentUser.client_account.client_account_id }
        : {}),
      ...(currentUser.stylist_account?.account_id
        ? { stylistAccountId: currentUser.stylist_account.account_id }
        : {}),
    });
    const meta: MessagingThreadMeta = {
      pair_id: pair.id,
      status: pair.status === 'CONTACT' ? 'PENDING' : pair.status,
      relationship_state: pair.status,
      counterpart_name: counterpartName(side, {
        clientName: pair.client_user?.name ?? null,
        clientEmail: pair.client_user?.email ?? null,
        pairStatus: pair.status,
        clientIsActive: pair.client_user?.is_active ?? false,
        stylistDisplayName: pair.stylist_account?.display_name ?? null,
        stylistBusinessName: pair.stylist_account?.business_name ?? null,
      }),
      // Full photo chain: own upload, then the OAuth image, then initials in the
      // UI. The thread used to read only the column that had no write path, so a
      // conversation with a stylist always showed initials.
      counterpart_avatar_url:
        side === StylistClientMessageSenderValue.CLIENT
          ? resolvePersonAvatarUrl(pair.stylist_account?.created_by_user ?? {})
          : resolvePersonAvatarUrl(pair.client_user ?? {}),
      viewer_side: side,
      counterpart_stylist_id:
        side === StylistClientMessageSenderValue.CLIENT
          ? pair.stylist_account_id
          : null,
      can_send: canSendToPair(pair.status),
      // Hide marker on the caller's side. A hidden thread still opens, from
      // „Pokaż ukryte" and from a deep link. It is the caller's own data.
      // The view shows „Przywróć" instead of „Ukryj".
      hidden_at:
        side === StylistClientMessageSenderValue.CLIENT
          ? pair.client_hidden_at
          : pair.stylist_hidden_at,
    };
    const read_through = messages.reduce<Date | null>((latest, message) => {
      const activity = new Date(message.activity_at ?? message.created_at);
      return latest == null || activity > latest ? activity : latest;
    }, null);
    return success({ meta, messages, next_cursor, read_through });
  } catch (error) {
    return databaseFailure('getThread', error);
  }
};
export const getConversations_IO = async (params: {
  currentUser: CurrentUser;
  cursor?: string;
  /** D2: true = WYŁĄCZNIE rozmowy ukryte przez wołającego („Pokaż ukryte"). */
  hidden?: boolean;
}): Promise<
  OperationResult<
    {
      conversations: MessagingConversationDTO[];
      unread_count: number;
      unread_conversation_count: number;
      next_cursor: string | null;
    },
    DatabaseError
  >
> => {
  const { currentUser, cursor } = params;
  const stylistAccountId = currentUser.stylist_account?.account_id ?? null;
  // DECISION: HIDE = MUTE. The hide filter sits in BOTH findMany branches (client side reads
  // client_hidden_at, stylist side stylist_hidden_at), so a hidden thread drops out of the default list, the
  // unread summary (the badge counts this list) and keyset pagination. A new message bumps last_message_at but
  // does NOT clear the marker: the thread stays hidden until an explicit restore. The `hidden=true` list
  // inverts the predicate (IS NOT NULL) and is the source of the restore action.
  const hiddenOnly = params.hidden === true;
  const clientHiddenWhere = hiddenOnly
    ? { client_hidden_at: { not: null } }
    : { client_hidden_at: null };
  const stylistHiddenWhere = hiddenOnly
    ? { stylist_hidden_at: { not: null } }
    : { stylist_hidden_at: null };
  try {
    const cursorWhere = conversationCursorWhere(cursor);
    const selectPair = {
      id: true,
      status: true,
      last_message_at: true,
      client_last_read_at: true,
      stylist_last_read_at: true,
      client_hidden_at: true,
      stylist_hidden_at: true,
      client_user_id: true,
      stylist_account_id: true,
      client_user: {
        select: {
          name: true,
          email: true,
          is_active: true,
          image: true,
          avatar_url: true,
        },
      },
      stylist_account: {
        select: {
          display_name: true,
          business_name: true,
          created_by_user: {
            select: { image: true, avatar_url: true, is_active: true },
          },
        },
      },
    } as const;
    // Both sides run in PARALLEL (independent findMany on the same cursor parameters; sequential awaits
    // doubled the latency of the polled inbox for dual-role users).
    // DECISION: counterpart visibility mask, mirror of pairing-query.operations.ts getMyPairs_IO
    // (client viewing stylists: stylist_account.account_status=ACTIVE; stylist viewing clients:
    // client_user.is_active=true). Messaging is a live-relation surface, so a soft-deleted or disabled
    // counterpart (the pair stays ACTIVE per Model A) does not appear in the inbox; without it a ghost pair
    // with that counterpart's PII would render with can_send=true (write into the void).
    const [clientPairs, stylistPairs] = await Promise.all([
      // Strona KLIENTA: pary gdzie caller = client_user (counterpart = stylistka).
      DB_CLIENT.use.clientStylistPair.findMany({
        where: {
          client_user_id: currentUser.id,
          stylist_account: {
            account_status: AccountStatusValue.ACTIVE,
            created_by_user: { is_active: true },
          },
          ...clientHiddenWhere,
          ...cursorWhere,
        },
        orderBy: [{ last_message_at: 'desc' }, { id: 'desc' }],
        take: CONVERSATIONS_PAGE + 1,
        select: selectPair,
      }),
      // Stylist side: pairs where the caller owns the stylist account.
      // The counterpart is the client. Clients have no account_status, so
      // is_active is their only visibility flag (see the stylist branch of getMyPairs_IO).
      stylistAccountId != null
        ? DB_CLIENT.use.clientStylistPair.findMany({
            where: {
              stylist_account_id: stylistAccountId,
              client_user: { is_active: true },
              ...stylistHiddenWhere,
              ...cursorWhere,
            },
            orderBy: [{ last_message_at: 'desc' }, { id: 'desc' }],
            take: CONVERSATIONS_PAGE + 1,
            select: selectPair,
          })
        : Promise.resolve([]),
    ]);
    // Merge and sort (last_message_at DESC, id DESC, the same total order as the
    // keyset, so pagination stays consistent) and cut to one page.
    const merged = [...clientPairs, ...stylistPairs].sort((a, b) => {
      const ta = a.last_message_at?.getTime() ?? 0;
      const tb = b.last_message_at?.getTime() ?? 0;
      if (tb !== ta) {
        return tb - ta;
      }
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });
    const hasMore = merged.length > CONVERSATIONS_PAGE;
    const pagePairs = hasMore ? merged.slice(0, CONVERSATIONS_PAGE) : merged;
    const lastPair = pagePairs[pagePairs.length - 1];
    const next_cursor =
      hasMore && lastPair?.last_message_at != null
        ? `${lastPair.last_message_at.toISOString()}|${lastPair.id}`
        : null;
    const [aggregateRows, unreadSummary] = await Promise.all([
      loadConversationAggregates(
        pagePairs.map(pair => pair.id),
        currentUser.id
      ),
      loadVisibleUnreadConversationCount(
        currentUser.id,
        stylistAccountId,
        hiddenOnly
      ),
    ]);
    const aggregatesByPairId = new Map(
      aggregateRows.map(row => [row.pair_id, row] as const)
    );
    const conversations: MessagingConversationDTO[] = pagePairs.map(pair => {
      const side =
        pair.client_user_id === currentUser.id
          ? StylistClientMessageSenderValue.CLIENT
          : StylistClientMessageSenderValue.STYLIST;
      const isClient = side === StylistClientMessageSenderValue.CLIENT;
      const aggregate = aggregatesByPairId.get(pair.id);
      const lastMessageContent = aggregate?.last_message_content ?? null;
      return {
        pair_id: pair.id,
        status: pair.status === 'CONTACT' ? 'PENDING' : pair.status,
        relationship_state: pair.status,
        viewer_side: side,
        counterpart_name: counterpartName(side, {
          clientName: pair.client_user?.name ?? null,
          clientEmail: pair.client_user?.email ?? null,
          pairStatus: pair.status,
          clientIsActive: pair.client_user?.is_active ?? false,
          stylistDisplayName: pair.stylist_account?.display_name ?? null,
          stylistBusinessName: pair.stylist_account?.business_name ?? null,
        }),
        counterpart_avatar_url: isClient
          ? resolvePersonAvatarUrl(pair.stylist_account?.created_by_user ?? {})
          : resolvePersonAvatarUrl(pair.client_user ?? {}),
        last_message_preview:
          lastMessageContent != null ? previewOf(lastMessageContent) : null,
        last_message_at: pair.last_message_at,
        // Concurrent pair delete between the page query and aggregate query is
        // represented as an empty aggregate, never a 500 / missing conversation.
        unread_count: aggregate?.unread_count ?? 0,
        can_send: canSendToPair(pair.status),
        hidden_at: isClient ? pair.client_hidden_at : pair.stylist_hidden_at,
      };
    });
    return success({ conversations, next_cursor, ...unreadSummary });
  } catch (error) {
    return databaseFailure('getConversations', error);
  }
};
