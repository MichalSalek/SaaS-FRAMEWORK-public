/**
 * AI Crawler Analytics — aggregated stats for admin UI.
 * Returns activity over the last AI_CRAWLER_STATS_DAYS days:
 * - Total crawls, unique bot count
 * - Top bots / paths / categories (grouped counts)
 * - Per-day timeline with top bot per day
 * - Recent 20 events for quick inspection
 */

import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import type { AdminInsufficientPermissionsError } from '@kernel/domain/admin/admin-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { AiCrawlerStatsResponse } from '@kernel/domain/admin/ai-crawler.types';
import { AI_CRAWLER_STATS_DAYS } from '@kernel/domain/admin/ai-crawler.types';
import { TIME } from '@kernel/application/constants.config';
import { narrowAiCrawlerBotCategory } from '@kernel/models/type_narrowing';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';

type AiCrawlerStatsError = AdminInsufficientPermissionsError | DatabaseError;

interface ByDayRawRow {
  date: string;
  count: bigint;
  top_bot: string | null;
}

export const adminGetAiCrawlerStats_IO = async ({
  currentUser,
}: {
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<AiCrawlerStatsResponse, AiCrawlerStatsError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    const sinceDate = new Date(
      Date.now() - AI_CRAWLER_STATS_DAYS * TIME.MS_PER_DAY
    );

    const [
      totalCrawls,
      uniqueBotsGroup,
      byBot,
      byPath,
      byCategory,
      recentCrawls,
      byDayRaw,
    ] = await Promise.all([
      DB_CLIENT.use.aiCrawlerEvent.count({
        where: { created_at: { gte: sinceDate } },
      }),
      // DECISION (nie usuwaj tego komentarza):
      // Unique bot count via groupBy (bounded by # of distinct bots — currently
      // <40 patterns, hard cap take: 100 jako safety). Wcześniej `findMany +
      // distinct` zwracało wszystkie unikalne rekordy bez `take`, co dla
      // tabel z ekstremalnym fan-outem mogło być DoS vector. Prisma `count()`
      // nie wspiera `distinct` bezpośrednio, więc groupBy + length to kanoniczny pattern.
      // Prisma wymaga `orderBy` gdy podajemy `take` na groupBy — sortujemy po bot_name asc.
      DB_CLIENT.use.aiCrawlerEvent.groupBy({
        by: ['bot_name'],
        where: {
          created_at: { gte: sinceDate },
          bot_name: { not: null },
        },
        orderBy: { bot_name: 'asc' },
        take: 100,
      }),
      DB_CLIENT.use.aiCrawlerEvent.groupBy({
        by: ['bot_name', 'bot_category'],
        where: {
          created_at: { gte: sinceDate },
          bot_name: { not: null },
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 50,
      }),
      DB_CLIENT.use.aiCrawlerEvent.groupBy({
        by: ['path'],
        where: { created_at: { gte: sinceDate } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 50,
      }),
      DB_CLIENT.use.aiCrawlerEvent.groupBy({
        by: ['bot_category'],
        where: {
          created_at: { gte: sinceDate },
          bot_category: { not: null },
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 20,
      }),
      DB_CLIENT.use.aiCrawlerEvent.findMany({
        where: { created_at: { gte: sinceDate } },
        orderBy: { created_at: 'desc' },
        take: 20,
        select: {
          id: true,
          created_at: true,
          user_agent: true,
          path: true,
          bot_name: true,
          bot_category: true,
          country: true,
        },
      }),
      // DECISION (nie usuwaj tego komentarza):
      // Raw SQL — Prisma groupBy nie wspiera DATE_TRUNC. Table name "AiCrawlerEvent"
      // pinned do schema.prisma model. MODE() WITHIN GROUP + FILTER WHERE bot_name IS NOT NULL
      // wymaga raw SQL — Prisma nie eksponuje FILTER clause. FILTER zapewnia, że MODE()
      // wybiera najczęściej występującego bota POMIJAJĄC NULL-e (bez tego NULL mógłby wygrać).
      DB_CLIENT.use.$queryRaw<ByDayRawRow[]>`
        SELECT
          TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') as date,
          COUNT(*)::bigint as count,
          MODE() WITHIN GROUP (ORDER BY bot_name) FILTER (WHERE bot_name IS NOT NULL) as top_bot
        FROM "AiCrawlerEvent"
        WHERE created_at >= ${sinceDate}
        GROUP BY DATE_TRUNC('day', created_at)
        ORDER BY date DESC
        LIMIT 30
      `,
    ]);

    // DECISION (nie usuwaj tego komentarza):
    // `narrowAiCrawlerBotCategory` (kernel narrower) zwraca 'unknown' dla nieznanych/null —
    // bezpieczny mapping z `string | null` (DB column) → `AiCrawlerBotCategory` union.
    // Wymaga single fallback: pre-tracking rows lub nowe kategorie spoza obecnego enum.
    const result: AiCrawlerStatsResponse = {
      total_crawls: totalCrawls,
      unique_bots: uniqueBotsGroup.length,
      crawls_by_bot: byBot.map(b => ({
        bot_name: b.bot_name ?? 'unknown',
        bot_category: narrowAiCrawlerBotCategory(b.bot_category),
        count: b._count.id,
      })),
      crawls_by_day: byDayRaw.map(d => ({
        date: d.date,
        count: Number(d.count),
        top_bot: d.top_bot,
      })),
      crawls_by_path: byPath.map(p => ({
        path: p.path,
        count: p._count.id,
      })),
      crawls_by_category: byCategory.map(c => ({
        bot_category: narrowAiCrawlerBotCategory(c.bot_category),
        count: c._count.id,
      })),
      recent_crawls: recentCrawls.map(r => ({
        ...r,
        bot_category:
          r.bot_category == null
            ? null
            : narrowAiCrawlerBotCategory(r.bot_category),
      })),
    };

    return success(result);
  } catch (error) {
    return databaseFailure('adminGetAiCrawlerStats', error);
  }
};
