/**
 * AI Crawler Analytics — retention cleanup.
 *
 * Removes AiCrawlerEvent rows older than AI_CRAWLER_RETENTION_DAYS.
 * Pattern 1:1 with cleanupOldEventLogs_IO (deleteMany + reportable result).
 *
 * Retention 90 days is longer than AI_CRAWLER_STATS_DAYS (30) so consecutive 30-day windows can be
 * compared; an age limit alone is enough, no count cap.
 */

import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';

export const AI_CRAWLER_RETENTION_DAYS = 90;

export const cleanupOldAiCrawlerEvents_IO = async (): Promise<
  OperationResult<{ deleted: number }, DatabaseError>
> => {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - AI_CRAWLER_RETENTION_DAYS);

    const result = await DB_CLIENT.use.aiCrawlerEvent.deleteMany({
      where: { created_at: { lt: cutoff } },
    });

    return success({ deleted: result.count });
  } catch (error) {
    return databaseFailure('cleanupOldAiCrawlerEvents', error);
  }
};
