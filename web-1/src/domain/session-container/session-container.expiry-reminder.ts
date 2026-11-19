import { TIME } from '@kernel/application/constants.config';
import {
  AccountTypeValue,
  SessionContainerLifecycleStateValue,
} from '@kernel/models/db_models.generated.dto';
import { NotificationTypeValue } from '@kernel/models/notifications/notifications.dto';
import { DB_CLIENT } from '@app/db/db.client';
import { withWriteTx } from '@app/db/with-write-tx';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { createOrRearmNotification_IO } from '@domain/notifications/operations/notification-write.operations';
import { dispatchPushForNotification_IO } from '@domain/notifications/push/push-dispatch.service';
import { notificationDedupKey } from '@domain/notifications/notification-dedup';
import { NOTIFICATION_TARGETS } from '@domain/notifications/notification-target.resolver';
import { lockSessionActivityContext } from './session-activity.lock';

/** Both sides hear once, three days before the shared session closes. */
export const SESSION_EXPIRY_REMINDER_DAYS = 3;

const REMINDER_BATCH = 500;

export const sendSessionExpiryReminders = async ({
  now = new Date(),
}: {
  now?: Date;
} = {}): Promise<number> => {
  const windowEnd = new Date(
    now.getTime() + SESSION_EXPIRY_REMINDER_DAYS * TIME.MS_PER_DAY
  );
  const sessions = await DB_CLIENT.use.sessionContainer.findMany({
    where: {
      lifecycle_state: {
        in: [
          SessionContainerLifecycleStateValue.SHARED,
          SessionContainerLifecycleStateValue.ACTIVE,
        ],
      },
      closed_at: null,
      expires_at: { gt: now, lte: windowEnd },
      expiry_reminder_sent_at: null,
    },
    select: { id: true },
    orderBy: { expires_at: 'asc' },
    take: REMINDER_BATCH,
  });

  let completed = 0;
  for (const candidate of sessions) {
    try {
      const committed = await withWriteTx(async tx => {
        // Match close/revoke lock order and re-read every eligibility condition
        // under the locks. The shortlist is only a hint, never an access grant.
        const context = await lockSessionActivityContext(tx, candidate.id);
        const session = context?.session;
        if (
          !context ||
          !session ||
          !session.shared_at ||
          (session.lifecycle_state !==
            SessionContainerLifecycleStateValue.SHARED &&
            session.lifecycle_state !==
              SessionContainerLifecycleStateValue.ACTIVE) ||
          session.closed_at ||
          session.expiry_reminder_sent_at ||
          !session.expires_at ||
          session.expires_at <= now ||
          session.expires_at > windowEnd
        ) {
          return null;
        }
        const client = await tx.user.findUnique({
          where: { id: context.userId },
          select: { is_active: true },
        });
        if (!client?.is_active) {
          return null;
        }
        let stylistUserId: string | null = null;
        if (session.stylist_account_id) {
          if (!context.activePairId) {
            return null;
          }
          // The assignment could change between the helper's initial read and
          // the session lock. Require the locked active pair to match it.
          const pair = await tx.clientStylistPair.findFirst({
            where: {
              id: context.activePairId,
              client_user_id: context.userId,
              stylist_account_id: session.stylist_account_id,
              status: 'ACTIVE',
            },
            select: {
              stylist_account: { select: { created_by_user_id: true } },
            },
          });
          if (!pair) {
            return null;
          }
          stylistUserId = pair.stylist_account.created_by_user_id;
        }
        const dedupKey = notificationDedupKey(
          NotificationTypeValue.SESSION_EXPIRING_SOON,
          session.id
        );
        const common = {
          type: NotificationTypeValue.SESSION_EXPIRING_SOON,
          dedupKey,
          actorUserId: null,
          actorName: null,
          rearm: false,
        } as const;
        const clientResult = await createOrRearmNotification_IO(
          {
            ...common,
            userId: context.userId,
            recipientRole: AccountTypeValue.CLIENT,
            targetPath: NOTIFICATION_TARGETS.sessionExpiringClient(session.id),
          },
          tx
        );
        if (!clientResult.success) {
          throw new Error('Could not store client expiry reminder');
        }
        const notifications = [clientResult.data];
        if (stylistUserId) {
          const stylistResult = await createOrRearmNotification_IO(
            {
              ...common,
              userId: stylistUserId,
              recipientRole: AccountTypeValue.STYLIST,
              targetPath: NOTIFICATION_TARGETS.sessionShared(session.id),
            },
            tx
          );
          if (!stylistResult.success) {
            throw new Error('Could not store stylist expiry reminder');
          }
          notifications.push(stylistResult.data);
        }
        await tx.sessionContainer.update({
          where: { id: session.id },
          data: { expiry_reminder_sent_at: now },
        });
        return notifications;
      });
      if (!committed) {
        continue;
      }
      completed += 1;
      // Push is best-effort and must never run while the database locks are held.
      const pushes = await Promise.allSettled(
        committed
          .filter(row => row.created)
          .map(row =>
            dispatchPushForNotification_IO({
              userId: row.notification.user_id,
              notification: row.notification,
            })
          )
      );
      if (pushes.some(push => push.status === 'rejected')) {
        reportIssueBackend({
          namespace: 'SESSION_CONTAINER_EXPIRY_REMINDER_PUSH',
          message: 'Expiry reminder push dispatch failed after commit',
          payload: { sessionId: candidate.id },
          mode: 'error',
        });
      }
    } catch (error) {
      reportIssueBackend({
        namespace: 'SESSION_CONTAINER_EXPIRY_REMINDER',
        message: 'Failed to store expiry reminders; the next sweep can retry',
        payload: {
          sessionId: candidate.id,
          error: error instanceof Error ? error.message : String(error),
        },
        mode: 'error',
      });
    }
  }

  if (completed > 0) {
    reportIssueBackend({
      namespace: 'SESSION_CONTAINER_EXPIRY_REMINDER',
      message: `Stored ${completed} inspiration-session expiry reminders`,
      payload: { count: completed },
      mode: 'info',
    });
  }
  return completed;
};
