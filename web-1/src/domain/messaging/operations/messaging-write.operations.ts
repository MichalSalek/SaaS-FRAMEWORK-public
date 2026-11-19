import { runMessagingTransaction_IO } from './messaging-transaction.helper';
import { nextConversationActivity } from '@domain/session-container/session-activity.clock';
import type { Prisma } from '../../../prisma/js-client';
import { resolveSalonAccess_IO } from '@domain/pairing/salon-access.resolver';
/**
 * Messaging write operations — sendMessage_IO, markRead_IO,
 * setConversationHidden_IO (D2: ukryj / przywróć).
 *
 * Wysyłka: party-gate (resolvePairSide) + PENDING/ACTIVE-gate (canSendToPair) +
 * per-user godzinowy rate-limit, wszystko w SERIALIZABLE tx (count() = punkt
 * serializacji → cap TWARDY bez explicit-locków, parytet createSupportThread_IO).
 * Wysyłka bumpuje last_message_at + oznacza WŁASNĄ stronę jako przeczytaną.
 */
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { isSerializationConflict } from '@app/db/serialization-conflict';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { TIME } from '@kernel/application/constants.config';
import { success, failure } from '@kernel/application/result.types';
import type { OperationResult } from '@kernel/application/result.types';
import type {
  DatabaseError,
  SerializationConflictError,
} from '@kernel/application/common-errors.types';
import type { MessagingError } from '@kernel/domain/messaging/messaging-errors.types';
import {
  StylistClientMessageSenderValue,
  type MessagingMessageDTO,
  type StylistClientMessageSender,
} from '@kernel/models/messaging/messaging.dto';
import { type PairingStatus } from '@kernel/models/db_models.generated.dto';
import type { CurrentUser } from '@kernel/models/user/user.types';
import {
  resolvePairSide,
  canSendToPair,
  isCounterpartInactive,
} from '../messaging.helpers';
const MESSAGING_RATE_LIMIT = 60; // wiadomości / godzinę / user (czat luźniejszy niż support)
const RATE_LIMIT_WINDOW_MS = TIME.MS_PER_HOUR;
// Notification throttle: if this sender already wrote to this pair in the last
// 15 minutes, the next message sends no e-mail (a burst is one mail).
const NOTIFY_THROTTLE_MS = 15 * TIME.MS_PER_MINUTE;
// DECISION: same sender (same pair side) + same pair + IDENTICAL body within this window = one send
// repeated (double tap, retry after a dropped connection). The existing message is returned with the same
// success, with no second row and no notification. The window is short on purpose: a deliberate second
// "ok"/"thanks" a moment later is normal conversation and must pass. The check runs in the same
// SERIALIZABLE tx as the insert: two parallel twins read and write the same predicate, one gets 40001, and
// the inner retry sees the first's committed row and takes this branch.
export const MESSAGE_DEDUP_WINDOW_MS = 5000;
export type SendMessageResult = {
  message: MessagingMessageDTO;
  /** User do powiadomienia e-mailem (druga strona), albo null gdy throttled. */
  notifyRecipientUserId: string | null;
  /** The sender's side of this pair. The handler picks the notification name
   *  from it (CLIENT: personal name; STYLIST: business name). Without it, a user
   *  who is both a stylist and a client, writing as CLIENT, would leak her
   *  business name to the recipient. */
  senderSide: StylistClientMessageSender;
  /** Pair status. The senderName e-mail fallback applies only to ACTIVE.
   *  PII minimum before accept: the e-mail is shown only after ACCEPT. */
  pairStatus: PairingStatus;
};
export const sendMessage_IO = async (params: {
  currentUser: CurrentUser;
  pairId: string;
  content: string;
  tx?: Prisma.TransactionClient;
}): Promise<
  OperationResult<
    SendMessageResult,
    MessagingError | DatabaseError | SerializationConflictError
  >
> => {
  const { currentUser, pairId, content } = params;
  // The recipient's auto mark-read writes the same pair row outside the tx and
  // runs exactly when a message arrives (an active exchange), so 40001 tracks
  // ordinary use, not an anomaly. One inner retry removes that class from the
  // user: a rolled-back tx can be retried, and it does not create a second row.
  // After the second conflict, 409 stays as the retryable exit.
  const MAX_TX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_TX_ATTEMPTS; attempt++) {
    try {
      return await runMessagingTransaction_IO(
        params.tx,
        async tx => {
          const pair = await tx.clientStylistPair.findUnique({
            where: { id: pairId },
            select: {
              id: true,
              client_user_id: true,
              salon_origin_account_id: true,
              stylist_account_id: true,
              status: true,
              stylist_hidden_at: true,
              client_hidden_at: true,
              client_user: { select: { is_active: true } },
              stylist_account: {
                select: {
                  created_by_user_id: true,
                  account_status: true,
                  created_by_user: { select: { is_active: true } },
                },
              },
            },
          });
          // Anti-enumeration: brak pary == nie-strona → jeden werdykt.
          if (pair == null) {
            return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
          }
          if (
            pair.status === 'ACTIVE' &&
            pair.salon_origin_account_id &&
            !(await resolveSalonAccess_IO(
              pair.client_user_id,
              pair.stylist_account_id,
              tx
            ))
          ) {
            return failure({ type: 'MESSAGING_NOT_ALLOWED' as const });
          }
          const side = resolvePairSide(pair, currentUser);
          if (side == null) {
            return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
          }
          if (isCounterpartInactive(side, pair)) {
            return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
          }
          if (!canSendToPair(pair.status)) {
            return failure({ type: 'MESSAGING_NOT_ALLOWED' as const });
          }
          const duplicate = await tx.stylistClientMessage.findFirst({
            where: {
              pair_id: pairId,
              sender_type: side,
              kind: 'TEXT',
              content,
              created_at: {
                gte: new Date(Date.now() - MESSAGE_DEDUP_WINDOW_MS),
              },
            },
            orderBy: { created_at: 'desc' },
            select: {
              id: true,
              sender_type: true,
              content: true,
              created_at: true,
            },
          });
          if (duplicate) {
            return success({
              message: duplicate,
              // Pierwsze wysłanie już (ewentualnie) powiadomiło odbiorcę.
              notifyRecipientUserId: null,
              senderSide: side,
              pairStatus: pair.status,
            });
          }
          // DECISION: the cap counts the PERSON, not the side. The scope used to narrow to the side the send
          // came from (client: her `client_user_id`; stylist: her account), giving two disjoint buckets, so a
          // dual-role user got a double limit (measured: 60 as client (429) plus 60 as stylist (201) in one
          // hour), contradicting the constant's own "per user" comment. It now sums both sides of the same
          // person; the cap stays shared across all her conversations.
          const oneHourAgo = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
          const isClient = side === StylistClientMessageSenderValue.CLIENT;
          const callerStylistAccountId =
            currentUser.stylist_account?.account_id ?? null;
          const sentByThisHuman = {
            kind: 'TEXT' as const,
            created_at: { gte: oneHourAgo },
            OR: [
              {
                sender_type: StylistClientMessageSenderValue.CLIENT,
                pair: { client_user_id: currentUser.id },
              },
              ...(callerStylistAccountId !== null
                ? [
                    {
                      sender_type: StylistClientMessageSenderValue.STYLIST,
                      pair: { stylist_account_id: callerStylistAccountId },
                    },
                  ]
                : []),
            ],
          };
          const recentCount = await tx.stylistClientMessage.count({
            where: sentByThisHuman,
          });
          if (recentCount >= MESSAGING_RATE_LIMIT) {
            // Real unblock time: the window moves with the oldest message still
            // counted. Without it the only hint was the per-IP limiter headers,
            // which describe a different window of a few seconds and invite a
            // retry loop.
            const oldestInWindow = await tx.stylistClientMessage.findFirst({
              where: sentByThisHuman,
              orderBy: { created_at: 'asc' },
              select: { created_at: true },
            });
            const unblocksAt =
              (oldestInWindow?.created_at.getTime() ?? Date.now()) +
              RATE_LIMIT_WINDOW_MS;
            const retryAfterSeconds = Math.max(
              1,
              Math.ceil((unblocksAt - Date.now()) / 1000)
            );
            reportIssueBackend({
              namespace: 'MESSAGING_RATE_LIMITED',
              message: `User ${currentUser.id} exceeded messaging rate limit: ${recentCount}/${MESSAGING_RATE_LIMIT} in last hour`,
              payload: {
                userId: currentUser.id,
                pairId,
                currentCount: recentCount,
              },
              mode: 'info',
            });
            return failure({
              type: 'MESSAGING_RATE_LIMITED' as const,
              retryAfterSeconds,
            });
          }
          // Notification throttle: has this sender written to this pair in the last 15 minutes?
          const throttleSince = new Date(Date.now() - NOTIFY_THROTTLE_MS);
          const recentFromSender = await tx.stylistClientMessage.count({
            where: {
              pair_id: pairId,
              sender_type: side,
              kind: 'TEXT',
              created_at: { gte: throttleSince },
            },
          });
          const now = await nextConversationActivity(tx, pairId);
          // created_at comes from the same application clock as last_message_at
          // and the *_last_read_at watermarks. The schema @default(now()) used the
          // database clock, and unread compares created_at > myLastRead, so clock
          // skew moved the unread boundary. A message could be born before its own
          // pair bump, or after someone else's mark-read from the future.
          const message = await tx.stylistClientMessage.create({
            data: {
              pair_id: pairId,
              sender_type: side,
              content,
              created_at: now,
              activity_at: now,
            },
            select: {
              id: true,
              sender_type: true,
              content: true,
              created_at: true,
            },
          });
          // Bump last_message_at and mark the sender's own side read. The sender
          // has read up to her own message, so her unread is 0.
          await tx.clientStylistPair.update({
            where: { id: pairId },
            data: {
              last_message_at: now,
              ...(isClient
                ? { client_last_read_at: now }
                : { stylist_last_read_at: now }),
            },
          });
          const recipientUserId = isClient
            ? pair.stylist_account.created_by_user_id
            : pair.client_user_id;
          // DECISION: HIDE = MUTE. When the RECIPIENT hid this conversation no notification goes out, but the
          // send returns exactly the same success: the message is stored and last_message_at bumped as usual
          // (anti-oracle: the sender cannot learn she was muted; the thread does not reappear for the other side
          // because the list filters the marker rather than clearing it).
          const recipientHidden = isClient
            ? pair.stylist_hidden_at != null
            : pair.client_hidden_at != null;
          return success({
            message,
            notifyRecipientUserId:
              recentFromSender > 0 || recipientHidden ? null : recipientUserId,
            senderSide: side,
            pairStatus: pair.status,
          });
        },
        { isolationLevel: 'Serializable' }
      );
    } catch (error) {
      if (params.tx) {
        throw error;
      }
      if (isSerializationConflict(error)) {
        if (attempt < MAX_TX_ATTEMPTS) {
          continue;
        }
        return failure({ type: 'SERIALIZATION_CONFLICT' });
      }
      return databaseFailure('sendMessage', error);
    }
  }
  // Nieosiągalne (pętla zawsze zwraca) — domknięcie dla TS.
  return failure({ type: 'SERIALIZATION_CONFLICT' });
};
export { markRead_IO } from './messaging-read.operations';
/**
 * Hide (`hidden=true`) or restore (`hidden=false`) a conversation ON THE CALLER'S SIDE. Idempotent
 * (re-hide keeps the original marker, re-restore is a no-op).
 *
 * DECISION: the only gate is being a party to the pair (resolvePairSide: MESSAGING_PAIR_NOT_FOUND for a
 * non-party or missing pair, anti-enumeration). There is deliberately no status gate (PENDING/ACTIVE/REVOKED:
 * closed history after a refusal may be hidden too) and no counterpart-liveness gate (a conversation with an
 * inactive account may disappear from the inbox too). The one hide precondition is that the pair HAS a
 * thread (last_message_at != null): hiding an empty pair would be a black hole, because the "show hidden"
 * list only shows pairs with messages and it could never be restored; the UI does not offer it and the API
 * answers MESSAGING_NOT_ALLOWED. Restore has no such condition. updateMany with the full side-ownership
 * WHERE (IDOR-safe, one statement).
 */
export const setConversationHidden_IO = async (params: {
  currentUser: CurrentUser;
  pairId: string;
  hidden: boolean;
}): Promise<
  OperationResult<
    {
      pair_id: string;
      hidden_at: Date | null;
    },
    MessagingError | DatabaseError
  >
> => {
  const { currentUser, pairId, hidden } = params;
  try {
    const pair = await DB_CLIENT.use.clientStylistPair.findUnique({
      where: { id: pairId },
      select: {
        id: true,
        client_user_id: true,
        stylist_account_id: true,
        last_message_at: true,
        client_hidden_at: true,
        stylist_hidden_at: true,
      },
    });
    if (pair == null) {
      return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
    }
    const side = resolvePairSide(pair, currentUser);
    if (side == null) {
      return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
    }
    if (hidden && pair.last_message_at == null) {
      return failure({ type: 'MESSAGING_NOT_ALLOWED' as const });
    }
    const isClient = side === StylistClientMessageSenderValue.CLIENT;
    const current = isClient ? pair.client_hidden_at : pair.stylist_hidden_at;
    if (hidden && current != null) {
      return success({ pair_id: pairId, hidden_at: current });
    }
    if (!hidden && current == null) {
      return success({ pair_id: pairId, hidden_at: null });
    }
    const nextValue = hidden ? new Date() : null;
    const stylistAccountId = currentUser.stylist_account?.account_id ?? '';
    await DB_CLIENT.use.clientStylistPair.updateMany({
      where: {
        id: pairId,
        ...(isClient
          ? { client_user_id: currentUser.id }
          : { stylist_account_id: stylistAccountId }),
      },
      data: isClient
        ? { client_hidden_at: nextValue }
        : { stylist_hidden_at: nextValue },
    });
    return success({ pair_id: pairId, hidden_at: nextValue });
  } catch (error) {
    return databaseFailure('setConversationHidden', error);
  }
};
