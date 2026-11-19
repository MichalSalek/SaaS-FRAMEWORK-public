import { DB_CLIENT } from '@app/db/db.client';
import type { MessagingMessageDTO } from '@kernel/models/messaging/messaging.dto';
import { sessionStylistRelationshipWhere } from './session-activity.access';
import type { Prisma } from '../../prisma/js-client';

/** Resolve current media in one query, without storing URL snapshots in messages. */
export const hydrateSessionActivityPreviews = async (
  messages: MessagingMessageDTO[],
  viewer: {
    userId: string;
    clientAccountId?: string;
    stylistAccountId?: string;
  }
): Promise<MessagingMessageDTO[]> => {
  const ids = [
    ...new Set(
      messages.flatMap(message =>
        message.session_id ? [message.session_id] : []
      )
    ),
  ];
  if (!ids.length) {
    return messages;
  }
  const visiblePhotoWhere = {
    OR: [
      { gallery_record: { is_hidden: false } },
      ...(viewer.stylistAccountId
        ? [
            {
              gallery_record: {
                created_by_account_id: viewer.stylistAccountId,
              },
              session: {
                client_account: { created_by_user_id: { not: viewer.userId } },
              },
            },
          ]
        : []),
    ],
  } satisfies Prisma.SessionContainerPhotoWhereInput;
  const sessions = await DB_CLIENT.use.sessionContainer.findMany({
    where: {
      id: { in: ids },
      OR: [
        { client_account: { created_by_user_id: viewer.userId } },
        ...(viewer.stylistAccountId
          ? [
              {
                stylist_account_id: viewer.stylistAccountId,
                shared_at: { not: null },
                ...sessionStylistRelationshipWhere(viewer.stylistAccountId),
              },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      stylist_account_id: true,
      client_account: { select: { created_by_user_id: true } },
      _count: { select: { photos: { where: visiblePhotoWhere } } },
      photos: {
        where: visiblePhotoWhere,
        orderBy: { position: 'asc' },
        take: 4,
        select: {
          gallery_record: {
            select: {
              asset_url: true,
              is_hidden: true,
              created_by_account_id: true,
            },
          },
        },
      },
    },
  });
  const byId = new Map(sessions.map(session => [session.id, session]));
  return messages.map(message => {
    if (!message.session_id) {
      return message;
    }
    const session = byId.get(message.session_id);
    if (!session) {
      return { ...message, session_id: null, session_preview: null };
    }
    const ownsAsClient =
      session.client_account.created_by_user_id === viewer.userId;
    const urls = session.photos.flatMap(({ gallery_record: record }) =>
      record.is_hidden &&
      (ownsAsClient || record.created_by_account_id !== viewer.stylistAccountId)
        ? []
        : [record.asset_url]
    );
    return {
      ...message,
      session_preview: {
        thumbnails: urls.slice(0, 4),
        remaining_count: Math.max(0, session._count.photos - urls.length),
      },
    };
  });
};
