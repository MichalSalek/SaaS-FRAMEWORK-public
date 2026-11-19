// DECISION: see web-1/src/application/scheduler/scheduled-jobs.registry.ts (what starts the periodic jobs).

/**
 * AI CRAWLER CLEANUP JOB
 *
 * Due every 24h (durable lease in JobLease, one run per interval across processes). Fire-and-forget — doesn't block requests.
 * Deletes AiCrawlerEvent rows older than AI_CRAWLER_RETENTION_DAYS (90 days).
 *
 * No advisory lock needed: deleteMany on already-deleted records is a no-op.
 * Concurrent instances running simultaneously just produce redundant 0-delete operations.
 *
 */

import { TIME } from '@kernel/application/constants.config';
import {
  defineScheduledJob,
  unwrapJobResult,
} from '@app/scheduler/scheduled-job';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { cleanupOldAiCrawlerEvents_IO } from './operations/ai-crawler-cleanup.operations';

export const aiCrawlerCleanupJob = defineScheduledJob({
  name: 'ai-crawler-cleanup',
  wakesOnTick: true,
  intervalMs: TIME.MS_PER_DAY,
  run: async () => {
    const data = unwrapJobResult(
      'ai-crawler-cleanup',
      await cleanupOldAiCrawlerEvents_IO()
    );

    if (data.deleted > 0) {
      reportIssueBackend({
        namespace: 'aiCrawlerCleanupInterceptor',
        message: `Deleted ${data.deleted} old AiCrawlerEvent records`,
        payload: { deleted: data.deleted },
        mode: 'info',
      });
    }
  },
});
