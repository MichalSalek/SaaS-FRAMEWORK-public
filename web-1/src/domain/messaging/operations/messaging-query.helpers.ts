import { DB_CLIENT } from '@app/db/db.client';
import { StylistClientMessageSenderValue } from '@kernel/models/messaging/messaging.dto';
import { Prisma } from '../../../prisma/js-client';

const PREVIEW_MAX = 120;

/**
 * Preview of the last message on the conversation list.
 *
 * `slice` cuts UTF-16 units, so an emoji outside the basic plane (common in
 * chat) split on the preview boundary and left a lone surrogate drawn as „�".
 * Cutting by code points keeps a surrogate pair intact. A composed sequence
 * (a skin-tone modifier, ZWJ) can still split. That needs grapheme segmentation
 * and stays outside this fix, which only removes the visible replacement glyph.
 */
export const previewOf = (content: string): string =>
  [...content].slice(0, PREVIEW_MAX).join('');

export type ConversationAggregateRow = {
  pair_id: string;
  last_message_content: string | null;
  unread_count: number;
};

/** One indexed aggregate per conversation, in a single round trip. */
export const loadConversationAggregates = async (
  pairIds: string[],
  userId: string
): Promise<ConversationAggregateRow[]> => {
  return pairIds.length === 0
    ? []
    : await DB_CLIENT.use.$queryRaw<ConversationAggregateRow[]>(Prisma.sql`
            SELECT
              p."id" AS pair_id,
              latest."content" AS last_message_content,
              unread."unread_count" AS unread_count
            FROM "ClientStylistPair" p
            LEFT JOIN LATERAL (
              SELECT m."content"
              FROM "StylistClientMessage" m
              WHERE m."pair_id" = p."id"
              ORDER BY m."activity_at" DESC, m."id" DESC
              LIMIT 1
            ) latest ON true
            CROSS JOIN LATERAL (
              SELECT COUNT(*)::int AS unread_count
              FROM "StylistClientMessage" m
              WHERE m."pair_id" = p."id"
                AND m."sender_type" = CASE
                  WHEN p."client_user_id" = ${userId}
                    THEN ${StylistClientMessageSenderValue.STYLIST}::"StylistClientMessageSender"
                  ELSE ${StylistClientMessageSenderValue.CLIENT}::"StylistClientMessageSender"
                END
                AND m."activity_at" > COALESCE(
                  CASE
                    WHEN p."client_user_id" = ${userId}
                      THEN p."client_last_read_at"
                    ELSE p."stylist_last_read_at"
                  END,
                  '-infinity'::timestamp
                )
            ) unread
            WHERE p."id" IN (${Prisma.join(pairIds)})
          `);
};

/** Count unread messages and conversations across the visible inbox, independent of the cursor. */
export const loadVisibleUnreadConversationCount = async (
  userId: string,
  stylistAccountId: string | null,
  hiddenOnly: boolean
): Promise<{ unread_count: number; unread_conversation_count: number }> => {
  const clientHidden = hiddenOnly
    ? Prisma.sql`p."client_hidden_at" IS NOT NULL`
    : Prisma.sql`p."client_hidden_at" IS NULL`;
  const stylistHidden = hiddenOnly
    ? Prisma.sql`p."stylist_hidden_at" IS NOT NULL`
    : Prisma.sql`p."stylist_hidden_at" IS NULL`;
  // Keep both branches aligned with getConversations_IO's visibility predicates.
  const rows = await DB_CLIENT.use.$queryRaw<
    Array<{ unread_count: number; unread_conversation_count: number }>
  >(Prisma.sql`
    WITH visible_pairs AS (
      SELECT p.* FROM "ClientStylistPair" p
      JOIN "StylistAccount" a ON a."account_id" = p."stylist_account_id"
      JOIN "users" u ON u."id" = a."created_by_user_id"
      WHERE p."client_user_id" = ${userId}
        AND a."account_status" = 'ACTIVE' AND u."is_active" = true
        AND p."last_message_at" IS NOT NULL AND ${clientHidden}
      UNION ALL
      SELECT p.* FROM "ClientStylistPair" p
      JOIN "users" u ON u."id" = p."client_user_id"
      WHERE p."stylist_account_id" = ${stylistAccountId}
        AND u."is_active" = true
        AND p."last_message_at" IS NOT NULL AND ${stylistHidden}
    )
    SELECT COALESCE(SUM(unread.count), 0)::int AS unread_count,
      COUNT(*) FILTER (WHERE unread.count > 0)::int AS unread_conversation_count
    FROM visible_pairs p
    CROSS JOIN LATERAL (
      SELECT COUNT(*) AS count FROM "StylistClientMessage" m
      WHERE m."pair_id" = p."id"
        AND m."sender_type" = CASE
          WHEN p."client_user_id" = ${userId}
            THEN ${StylistClientMessageSenderValue.STYLIST}::"StylistClientMessageSender"
          ELSE ${StylistClientMessageSenderValue.CLIENT}::"StylistClientMessageSender"
        END
        AND m."activity_at" > COALESCE(
          CASE WHEN p."client_user_id" = ${userId}
            THEN p."client_last_read_at" ELSE p."stylist_last_read_at" END,
          '-infinity'::timestamp
        )
    ) unread
  `);
  if (!rows[0]) {
    throw new Error('Unread aggregate returned no row');
  }
  return rows[0];
};
