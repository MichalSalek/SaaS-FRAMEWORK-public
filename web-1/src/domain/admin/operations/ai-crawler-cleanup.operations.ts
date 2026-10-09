/**
 * AI Crawler Analytics — retention cleanup.
 *
 * Removes AiCrawlerEvent rows older than AI_CRAWLER_RETENTION_DAYS.
 * Pattern 1:1 with cleanupOldEventLogs_IO (deleteMany + reportable result).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Retention 90 dni — dłuższe niż AI_CRAWLER_STATS_DAYS (30 dni) by dać overlap
 * dla porównań między 30-dniowymi oknami. Brak per-record cap (count-based) bo
 * tabela rośnie liniowo i hard age limit jest wystarczający dla MVP.
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
