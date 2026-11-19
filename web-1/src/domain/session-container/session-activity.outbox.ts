import { randomUUID } from 'node:crypto';
import { DB_CLIENT } from '@app/db/db.client';
import { emitInfoEventAndWait } from '@app/events/event-bus';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { dispatchPushForNotification_IO } from '@domain/notifications/push/push-dispatch.service';
import { resolveSalonAccess_IO } from '@domain/pairing/salon-access.resolver';

/** Immediate kick and the scheduled backstop use the same CAS lease. */
export const processSessionActivityOutbox_IO = async (sessionId?: string) => {
  const now = new Date();
  const due = {
    OR: [
      { status: 'PENDING', next_attempt_at: { lte: now } },
      { status: 'SENDING', leased_until: { lte: now } },
    ],
    ...(sessionId ? { session_id: sessionId } : {}),
  };
  const rows = await DB_CLIENT.use.sessionActivityOutbox.findMany({
    where: due,
    take: 50,
    orderBy: { created_at: 'asc' },
  });
  let delivered = 0;
  let failed = 0;
  for (const row of rows) {
    const token = randomUUID();
    const claimed = await DB_CLIENT.use.sessionActivityOutbox.updateMany({
      where: { event_key: row.event_key, ...due },
      data: {
        status: 'SENDING',
        lease_token: token,
        leased_until: new Date(Date.now() + 300_000),
        attempts: { increment: 1 },
      },
    });
    if (!claimed.count) {
      continue;
    }
    const fence = {
      event_key: row.event_key,
      lease_token: token,
      status: 'SENDING',
    };
    try {
      const pair = await DB_CLIENT.use.clientStylistPair.findUnique({
        where: { id: row.pair_id },
        include: {
          client_user: { select: { is_active: true, name: true } },
          stylist_account: {
            select: {
              account_status: true,
              created_by_user_id: true,
              created_by_user: { select: { is_active: true } },
            },
          },
        },
      });
      const session = await DB_CLIENT.use.sessionContainer.findUnique({
        where: { id: row.session_id },
      });
      const isClientRecipient = pair?.client_user_id === row.recipient_user_id;
      const muted = isClientRecipient
        ? pair?.client_hidden_at
        : pair?.stylist_hidden_at;
      const recipientMatches =
        pair &&
        (isClientRecipient ||
          pair.stylist_account.created_by_user_id === row.recipient_user_id);
      const salonAccess =
        pair?.salon_origin_account_id && pair.status === 'ACTIVE'
          ? await resolveSalonAccess_IO(
              pair.client_user_id,
              pair.stylist_account_id
            )
          : null;
      if (
        !pair ||
        !session ||
        !recipientMatches ||
        pair.status !== 'ACTIVE' ||
        (pair.salon_origin_account_id && !salonAccess) ||
        muted ||
        !pair.client_user.is_active ||
        !pair.stylist_account.created_by_user.is_active ||
        pair.stylist_account.account_status !== 'ACTIVE' ||
        session.stylist_account_id !== pair.stylist_account_id ||
        !session.shared_at
      ) {
        await DB_CLIENT.use.sessionActivityOutbox.updateMany({
          where: fence,
          data: { status: 'SUPPRESSED', lease_token: null, leased_until: null },
        });
        continue;
      }
      if (row.kind === 'SESSION_SUBMITTED') {
        await emitInfoEventAndWait(
          APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_SHARED,
          {
            stylistAccountId: pair.stylist_account_id,
            sessionId: row.session_id,
            clientUserId: pair.client_user_id,
            clientName: pair.client_user.name,
          }
        );
      }
      const notification = row.notification_id
        ? await DB_CLIENT.use.notification.findFirst({
            where: { id: row.notification_id, user_id: row.recipient_user_id },
          })
        : null;
      let suppressed = notification === null;
      if (notification) {
        const summary = await dispatchPushForNotification_IO({
          userId: row.recipient_user_id,
          notification,
        });
        if (
          summary.failed ||
          [
            'lookup-failed',
            'dispatch-failed',
            'provider-unconfigured',
          ].includes(summary.skipped ?? '')
        ) {
          throw new Error(
            `Push delivery incomplete: ${summary.skipped ?? 'provider-rejected'}`
          );
        }
        suppressed = summary.sent === 0 && summary.failed === 0;
      }
      const saved = await DB_CLIENT.use.sessionActivityOutbox.updateMany({
        where: { ...fence, leased_until: { gt: new Date() } },
        data: {
          status: suppressed ? 'SUPPRESSED' : 'DELIVERED',
          delivered_at: suppressed ? null : new Date(),
          leased_until: null,
          lease_token: null,
          last_error: null,
        },
      });
      delivered += saved.count;
    } catch (error) {
      failed += 1;
      if (row.attempts === 0 || row.attempts >= 9) {
        reportIssueBackend({
          namespace: 'SESSION_ACTIVITY_DELIVERY_FAILED',
          message:
            row.attempts >= 9
              ? 'Session activity delivery exhausted retries'
              : 'Session activity delivery failed; retry scheduled',
          payload: {
            eventKey: row.event_key,
            kind: row.kind,
            attempts: row.attempts + 1,
          },
          mode: row.attempts >= 9 ? 'error' : 'warn',
        });
      }
      await DB_CLIENT.use.sessionActivityOutbox.updateMany({
        where: fence,
        data: {
          status: row.attempts >= 9 ? 'FAILED' : 'PENDING',
          lease_token: null,
          leased_until: null,
          last_error:
            error instanceof Error
              ? error.message.slice(0, 1000)
              : 'Activity delivery failed',
          next_attempt_at: new Date(
            Date.now() + Math.min(1_800_000, 30_000 * 2 ** row.attempts)
          ),
        },
      });
    }
  }
  return { scanned: rows.length, delivered, failed };
};

export const kickSessionActivityOutbox = (sessionId: string): void => {
  runAfterResponse(async () => {
    try {
      await processSessionActivityOutbox_IO(sessionId);
    } catch (error) {
      reportIssueBackend({
        namespace: 'SESSION_ACTIVITY_OUTBOX',
        message: 'Post-commit delivery failed; scheduled retry remains pending',
        payload: { sessionId, error },
        mode: 'error',
      });
    }
  });
};
