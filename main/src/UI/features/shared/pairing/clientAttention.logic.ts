// UI/features/shared/pairing/clientAttention.logic.ts
// Which connected clients need the stylist, and the order that follows from
// it (no React). ONE copy for both readers: the dashboard face strip (a dot on
// a face) and the list on „Twoje klientki” (the same fact in words).

import { isActiveSession } from '@kernel/domain/session-container/session-container.types';
import type { SessionContainerLifecycleState } from '@kernel/models/db_models.generated.dto';

/** The slice of a pair row the ordering reads (both pair shapes carry it). */
export interface AttentionPairLike {
  /** ClientStylistPair.id: also the messaging conversation key (`pair_id`). */
  id: string;
  counterpart_inactive: boolean;
}

/** The slice of a conversation row the attention map reads. */
export interface UnreadConversationLike {
  pair_id: string;
  unread_count: number;
}

/**
 * Orders the clients and applies an optional cap (the dashboard strip shows
 * the first twelve; the full list passes none). Rank: clients who need
 * attention first, then the other active clients, then inactive
 * (non-tappable) ones. The sort is stable, so the API order (newest connection
 * first) holds inside every rank. An inactive client never ranks as "needs
 * attention": she has no link and carries no mark, so she must not take a
 * front slot.
 */
export function orderPairsByAttention<T extends AttentionPairLike>(
  pairs: readonly T[],
  needsAttention: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  max: number = Number.POSITIVE_INFINITY
): T[] {
  const rank = (pair: T): number => {
    if (pair.counterpart_inactive) {
      return 2;
    }
    return needsAttention.has(pair.id) ? 0 : 1;
  };
  return [...pairs].sort((a, b) => rank(a) - rank(b)).slice(0, max);
}

/**
 * Unread messages per pair id, only for pairs with at least one unread
 * message. Returns an EMPTY map whenever the source is not trustworthy
 * (loading, failed, or nothing cached): no mark beats a wrong mark, and an
 * empty map keeps the list in its plain order.
 */
export function resolveUnreadByPair(
  conversations: readonly UnreadConversationLike[],
  source: { isLoading: boolean; isError: boolean; hasData: boolean }
): ReadonlyMap<string, number> {
  const unread = new Map<string, number>();
  if (source.isLoading || source.isError || !source.hasData) {
    return unread;
  }
  for (const conversation of conversations) {
    if (conversation.unread_count > 0) {
      unread.set(conversation.pair_id, conversation.unread_count);
    }
  }
  return unread;
}

/** The slice of a stylist-side session row the attention map reads. */
export interface PendingSessionLike {
  clientUserId: string | null;
  lifecycleState: SessionContainerLifecycleState;
  expiresAt: string | null;
  /** The session's id: lets a client's row lead straight into her session. */
  id?: string;
}

/**
 * User ids of clients with a shared inspiration session still waiting for the
 * stylist: shared or active and not expired. Same definition as the
 * dashboard's „N sesji inspiracji” nudge (pending shares that have not
 * expired). Empty whenever the source is not trustworthy, like unread.
 */
export function resolvePendingSessionClients(
  sessions: readonly PendingSessionLike[],
  source: { isLoading: boolean; isError: boolean; hasData: boolean },
  now: number = Date.now()
): ReadonlySet<string> {
  return new Set(resolvePendingSessionByClient(sessions, source, now).keys());
}

/**
 * The same clients, each with the id of her waiting session (the first one
 * found: a client keeps one session per stylist). An id-less row maps to an
 * empty string, so the mark still shows and only the shortcut is absent.
 */
export function resolvePendingSessionByClient(
  sessions: readonly PendingSessionLike[],
  source: { isLoading: boolean; isError: boolean; hasData: boolean },
  now: number = Date.now()
): ReadonlyMap<string, string> {
  const byClient = new Map<string, string>();
  if (source.isLoading || source.isError || !source.hasData) {
    return byClient;
  }
  for (const session of sessions) {
    const expired =
      session.expiresAt !== null &&
      new Date(session.expiresAt).getTime() <= now;
    if (
      session.clientUserId !== null &&
      isActiveSession(session.lifecycleState) &&
      !expired &&
      !byClient.has(session.clientUserId)
    ) {
      byClient.set(session.clientUserId, session.id ?? '');
    }
  }
  return byClient;
}

/** Per-client attention: unread count by pair id and a waiting session. */
export interface ClientAttention {
  unreadByPair: ReadonlyMap<string, number>;
  pendingSessionClients: ReadonlySet<string>;
  /** Client user id → id of her waiting session ('' when unknown). */
  pendingSessionIdByClient: ReadonlyMap<string, string>;
}

/** Pair ids that need the stylist, for ordering (both sources combined). */
export function attentionPairIds(
  pairs: readonly (AttentionPairLike & { user_id?: string })[],
  attention: Pick<ClientAttention, 'unreadByPair' | 'pendingSessionClients'>
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const pair of pairs) {
    if (
      (attention.unreadByPair.get(pair.id) ?? 0) > 0 ||
      (pair.user_id !== undefined &&
        attention.pendingSessionClients.has(pair.user_id))
    ) {
      ids.add(pair.id);
    }
  }
  return ids;
}
