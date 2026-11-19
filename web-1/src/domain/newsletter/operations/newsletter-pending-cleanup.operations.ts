import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';

export const NEWSLETTER_PENDING_RETENTION_DAYS = 90;
export const NEWSLETTER_PENDING_CLEANUP_CAP = 1000;

export const cleanupStaleNewsletterPending_IO = async (): Promise<
  OperationResult<{ deleted: number }, DatabaseError>
> => {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - NEWSLETTER_PENDING_RETENTION_DAYS);

    const stalePendingWhere = {
      is_active: false,
      confirmed_at: null,
      created_at: { lt: cutoff },
      consent_events: { none: {} },
    };

    const candidates = await DB_CLIENT.use.newsletterSubscriber.findMany({
      where: stalePendingWhere,
      select: { id: true },
      take: NEWSLETTER_PENDING_CLEANUP_CAP,
    });

    if (candidates.length === 0) {
      return success({ deleted: 0 });
    }

    const result = await DB_CLIENT.use.newsletterSubscriber.deleteMany({
      where: {
        id: { in: candidates.map(candidate => candidate.id) },
        ...stalePendingWhere,
      },
    });

    return success({ deleted: result.count });
  } catch (error) {
    return databaseFailure('cleanupStaleNewsletterPending', error);
  }
};
