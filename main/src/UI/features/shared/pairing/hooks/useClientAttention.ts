import { useConversations } from '../../messaging/hooks/useConversations';
import { useSharedSessions } from '../../hooks/useSharedSessions';
import {
  resolvePendingSessionByClient,
  resolveUnreadByPair,
  type ClientAttention,
} from '../clientAttention.logic';

/**
 * What a connected client is waiting for (owner): unread messages
 * from her, or a shared inspiration session still waiting for the stylist.
 * Two readers, one copy (owner): the dashboard face strip marks the
 * face with a dot, the list on „Twoje klientki” says it in words.
 * Conversations reuse the visible-conversations cache the AppLayout badge
 * already polls; sessions reuse the stylist's shared-sessions query (first
 * page: a waiting session beyond it gets no mark, a missed mark, never a wrong
 * one). Hidden conversations never mark, as they never badge.
 */
export function useClientAttention(): ClientAttention {
  const conversations = useConversations();
  // DECISION: NOT gated on the feed's pending_shares_count. That count covers SHARED sessions only
  // while the marks read SHARED and ACTIVE, and a disabled query freezes its last list, so a closed
  // session kept its dot. One cached list request is the price of marks that match the sessions.
  const sessions = useSharedSessions();
  const pendingSessionIdByClient = resolvePendingSessionByClient(
    sessions.sessions,
    {
      isLoading: sessions.isLoading,
      isError: sessions.isError,
      hasData: sessions.data !== undefined,
    }
  );
  return {
    unreadByPair: resolveUnreadByPair(conversations.conversations, {
      isLoading: conversations.isLoading,
      isError: conversations.isError,
      hasData: conversations.hasData,
    }),
    pendingSessionClients: new Set(pendingSessionIdByClient.keys()),
    pendingSessionIdByClient,
  };
}
