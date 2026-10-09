// DECISION (nie usuwaj tego komentarza):
// Sweep odpalany przez request interceptor (NIE external cron). Świadoma decyzja
// Korekta 2026-07-19: uptime monitor jest DB-free i NIE jest traffic floorem.
// Sweep planuje się dopiero po zaakceptowanym ruchu aplikacji, gdy DB już była potrzebna.
// Monitoring: "last sweep at" w admin /health; >48h = sygnał do oceny external crona.

/**
 * AI CRAWLER CLEANUP INTERCEPTOR
 *
 * Runs once per 24h per instance. Fire-and-forget — doesn't block requests.
 * Deletes AiCrawlerEvent rows older than AI_CRAWLER_RETENTION_DAYS (90 days).
 *
 * No advisory lock needed: deleteMany on already-deleted records is a no-op.
 * Concurrent instances running simultaneously just produce redundant 0-delete operations.
 *
 * Throttle + timing + NEVER-throw catch = createSweepInterceptor (BDX W4.1).
 * Triggered by: HTTP middleware (every request checks, executes if 24h passed).
 */

import { TIME } from '@kernel/application/constants.config';
import { createSweepInterceptor } from '@app/interceptors/create-sweep-interceptor';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { cleanupOldAiCrawlerEvents_IO } from './operations/ai-crawler-cleanup.operations';

export const aiCrawlerCleanupInterceptor = createSweepInterceptor({
  name: 'ai-crawler-cleanup',
  throttleMs: TIME.MS_PER_DAY,
  run: async () => {
    const result = await cleanupOldAiCrawlerEvents_IO();

    if (result.success && result.data.deleted > 0) {
      reportIssueBackend({
        namespace: 'aiCrawlerCleanupInterceptor',
        message: `Deleted ${result.data.deleted} old AiCrawlerEvent records`,
        payload: { deleted: result.data.deleted },
        mode: 'info',
      });
    }
  },
});
