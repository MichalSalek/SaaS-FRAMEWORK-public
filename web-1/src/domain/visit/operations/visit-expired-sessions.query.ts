import { DB_CLIENT } from '@app/db/db.client';
import { VISIT_CONFIG } from '@kernel/domain/visit/visit.config';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';
import type { ExpiredSessionSummaryDTO } from '@kernel/models/visit/visit.dto';
import { SHARED_STATES_FOR_PRISMA } from '@domain/session-container/operations/session-container-shared.operations';
import { retentionCutoff } from './visit-common.operations';

/**
 * The client's shared sessions with this stylist that ran out of time, newest first, within the
 * plan's history window. Throws on a DB error: the caller's try/catch turns it into its result.
 *
 * DECISION: "expired" is the swept state OR a shared session past its expires_at that the sweep has
 * not reached yet (same rule as isPastTtl in session-container-shared.operations). A session that was
 * never shared (shared_at null) is not the stylist's to see, the same guard getSessionContainerById_IO
 * applies, so the row here always opens.
 */
export const loadExpiredSessionSummaries = async ({
  stylist_account_id,
  client_user_id,
  retentionDays,
}: {
  stylist_account_id: string;
  client_user_id: string;
  retentionDays: number;
}): Promise<ExpiredSessionSummaryDTO[]> => {
  const now = new Date();
  const cutoff = retentionCutoff(retentionDays);
  const sessions = await DB_CLIENT.use.sessionContainer.findMany({
    where: {
      stylist_account_id,
      client_account: { created_by_user_id: client_user_id },
      shared_at: { not: null },
      expires_at: { not: null, lte: now, ...(cutoff && { gte: cutoff }) },
      lifecycle_state: {
        in: [
          SessionContainerLifecycleStateValue.EXPIRED,
          ...SHARED_STATES_FOR_PRISMA,
        ],
      },
    },
    select: {
      id: true,
      name: true,
      shared_at: true,
      expires_at: true,
      _count: { select: { photos: true } },
    },
    orderBy: [{ expires_at: 'desc' }, { id: 'desc' }],
    take: VISIT_CONFIG.EXPIRED_SESSIONS_MAX,
  });

  return sessions.flatMap(session =>
    session.shared_at && session.expires_at
      ? [
          {
            id: session.id,
            name: session.name,
            sharedAt: session.shared_at.toISOString(),
            expiresAt: session.expires_at.toISOString(),
            photoCount: session._count.photos,
          },
        ]
      : []
  );
};
