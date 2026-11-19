import type { Prisma } from '../../prisma/js-client';
import type {
  SessionActivityKind,
  SessionChangeScope,
} from '@kernel/models/db_models.generated.dto';
import { enqueueEmailOutboxTx } from '@app/email-handler/outbox/email-outbox';
import { buildFrontendBaseUrl } from '@app/environment/environment.utils.api';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { sessionActivityTargetPath } from './session-activity.target';

export const sessionActivityContent = (
  kind: SessionActivityKind,
  scope: SessionChangeScope | null
): string => {
  if (kind === 'SESSION_SUBMITTED') {
    return 'Udostępniono sesję inspiracji do akceptacji';
  }
  if (kind === 'SESSION_ACCEPTED') {
    return 'Zaakceptowano sesję inspiracji';
  }
  const detail =
    scope === 'PHOTOS'
      ? 'zdjęcia'
      : scope === 'NOTE'
        ? 'notatka'
        : 'zdjęcia i notatka';
  return `Zmiany po akceptacji: ${detail}`;
};

const mergeScope = (
  a: SessionChangeScope | null,
  b: SessionChangeScope | null
): SessionChangeScope | null =>
  a === b || !b ? a : !a ? b : 'PHOTOS_AND_NOTE';

/** Caller holds User -> StylistAccount -> conversation -> session locks. */
export const writeSessionActivity = async (
  tx: Prisma.TransactionClient,
  input: {
    sessionId: string;
    pairId: string;
    kind: Exclude<SessionActivityKind, 'TEXT'>;
    activityAt: Date;
    changeScope?: SessionChangeScope;
  }
): Promise<void> => {
  const session = await tx.sessionContainer.findUniqueOrThrow({
    where: { id: input.sessionId },
  });
  if (input.kind === 'SESSION_CHANGED' && !session.accepted_at) {
    return;
  }
  const pair = await tx.clientStylistPair.findUnique({
    where: { id: input.pairId },
    include: {
      client_user: { select: { id: true, name: true, is_active: true } },
      stylist_account: {
        select: {
          created_by_user_id: true,
          created_by_user: { select: { name: true, is_active: true } },
        },
      },
    },
  });
  if (
    !pair ||
    pair.status !== 'ACTIVE' ||
    !pair.client_user.is_active ||
    !pair.stylist_account.created_by_user.is_active
  ) {
    return;
  }
  const previous = await tx.stylistClientMessage.findFirst({
    where: { pair_id: pair.id },
    orderBy: [{ activity_at: 'desc' }, { id: 'desc' }],
  });
  const grouped =
    input.kind === 'SESSION_CHANGED' &&
    previous?.kind === input.kind &&
    previous.session_id === input.sessionId &&
    input.activityAt.getTime() - previous.created_at.getTime() < 120_000;
  const scope = grouped
    ? mergeScope(previous.change_scope, input.changeScope ?? null)
    : (input.changeScope ?? null);
  const eventKey =
    grouped && previous.event_key
      ? previous.event_key
      : input.kind === 'SESSION_CHANGED'
        ? `SESSION_CHANGED:${input.sessionId}:${input.activityAt.toISOString()}`
        : `${input.kind}:${input.sessionId}`;
  const sender = input.kind === 'SESSION_ACCEPTED' ? 'STYLIST' : 'CLIENT';
  const message = grouped
    ? await tx.stylistClientMessage.update({
        where: { id: previous.id },
        data: {
          change_scope: scope,
          content: sessionActivityContent(input.kind, scope),
          activity_at: input.activityAt,
          revision: { increment: 1 },
        },
      })
    : await tx.stylistClientMessage.upsert({
        where: { event_key: eventKey },
        update: {},
        create: {
          pair_id: pair.id,
          sender_type: sender,
          kind: input.kind,
          session_id: input.sessionId,
          change_scope: scope,
          event_key: eventKey,
          content: sessionActivityContent(input.kind, scope),
          created_at: input.activityAt,
          activity_at: input.activityAt,
        },
      });
  await tx.clientStylistPair.update({
    where: { id: pair.id },
    data: { last_message_at: input.activityAt },
  });
  if (input.kind === 'SESSION_CHANGED') {
    await tx.sessionContainer.update({
      where: { id: input.sessionId },
      data: { last_client_change_at: input.activityAt },
    });
  }
  const recipientUserId =
    sender === 'STYLIST'
      ? pair.client_user_id
      : pair.stylist_account.created_by_user_id;
  const muted =
    sender === 'STYLIST' ? pair.client_hidden_at : pair.stylist_hidden_at;
  if (input.kind === 'SESSION_SUBMITTED' && !muted) {
    await enqueueEmailOutboxTx(
      tx,
      {
        userId: recipientUserId,
        accountId: pair.stylist_account_id,
        ruleId: 'session-shared',
        occurrence: session.id,
        templateId: 'session-shared-notification',
        subjectKey: 'email.sessionSharedNotification.subject',
        infoEvent: APP_EVENTS.INFO.EMAIL.EMAIL_SESSION_SHARED_NOTIFICATION_SENT,
        vars: {
          clientName: pair.client_user.name ?? '',
          sessionId: session.id,
          appUrl: `${buildFrontendBaseUrl()}/app/inbox/session/${session.id}`,
        },
      },
      input.activityAt
    );
  }
  const notification = muted
    ? null
    : await tx.notification.upsert({
        where: {
          user_id_dedup_key: { user_id: recipientUserId, dedup_key: eventKey },
        },
        create: {
          user_id: recipientUserId,
          recipient_role: sender === 'STYLIST' ? 'CLIENT' : 'STYLIST',
          type:
            input.kind === 'SESSION_SUBMITTED'
              ? 'SESSION_SHARED'
              : 'MESSAGE_RECEIVED',
          dedup_key: eventKey,
          actor_user_id:
            sender === 'STYLIST'
              ? pair.stylist_account.created_by_user_id
              : pair.client_user_id,
          actor_name:
            sender === 'STYLIST'
              ? pair.stylist_account.created_by_user.name
              : pair.client_user.name,
          // The bell opens the CONVERSATION that holds the activity card, not
          // the session directly: the card is the soft start for the chat and
          // carries the role-specific link to the session. (owner)
          target_path: sessionActivityTargetPath(pair.id),
          activity_kind: input.kind,
          session_id: input.sessionId,
          change_scope: scope,
          created_at: input.activityAt,
        },
        update: {
          read_at: null,
          created_at: input.activityAt,
          change_scope: scope,
        },
      });
  await tx.sessionActivityOutbox.upsert({
    where: { event_key: eventKey },
    update: {},
    create: {
      event_key: eventKey,
      pair_id: pair.id,
      session_id: input.sessionId,
      message_id: message.id,
      recipient_user_id: recipientUserId,
      kind: input.kind,
      notification_id: notification?.id ?? null,
      status: muted ? 'SUPPRESSED' : 'PENDING',
    },
  });
};
