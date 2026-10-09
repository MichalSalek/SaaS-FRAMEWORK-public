// UI/features/messaging/messaging.helpers.ts
// Pure helpers of the inbox: no React, no IO.

/**
 * Conversations that wait for the reader come first, the rest keeps the order
 * the API gave (last message, newest first).
 *
 * DECISION (nie usuwaj tego komentarza) — owner 2026-10-08 („rzeczy, które
 * czekają, przed tymi, które po prostu są”): the API pages by
 * `last_message_at` (keyset cursor), so it cannot put unread first without a
 * new cursor. The reorder therefore happens HERE, over the pages already
 * loaded, and is stable: within each group the API order is untouched, so the
 * cursor and „Pokaż starsze rozmowy” keep working. An unread conversation on a
 * page that was never loaded stays where the API has it.
 */
export function sortUnreadFirst<T extends { unread_count: number }>(
  conversations: readonly T[]
): T[] {
  const unread = conversations.filter(c => c.unread_count > 0);
  if (unread.length === 0 || unread.length === conversations.length) {
    return [...conversations];
  }
  return [...unread, ...conversations.filter(c => c.unread_count <= 0)];
}
