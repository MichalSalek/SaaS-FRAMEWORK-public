/**
 * AI Crawler Analytics — paginated raw event list for admin UI.
 * Supports filters: bot_category, bot_name, path, from_date, to_date.
 */

import type { Prisma } from '../../../prisma/js-client';
import { DB_CLIENT } from '@app/db/db.client';
import { TIME } from '@kernel/application/constants.config';
import type { OperationResult } from '@kernel/application/result.types';
import { failure, success } from '@kernel/application/result.types';
import type { AdminInsufficientPermissionsError } from '@kernel/domain/admin/admin-errors.types';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import type {
  AiCrawlerListQuery,
  AiCrawlerListResponse,
} from '@kernel/domain/admin/ai-crawler.types';
import {
  AI_CRAWLER_DEFAULT_PAGE_SIZE,
  AI_CRAWLER_MAX_PAGE_SIZE,
} from '@kernel/domain/admin/ai-crawler.types';
import {
  isAiCrawlerBotCategoryNarrower,
  narrowAiCrawlerBotCategory,
} from '@kernel/models/type_narrowing';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { cleanAdminFilter } from './admin-filter-sanitize.helper';
import { parsePgSafeDate } from '@kernel/policies/validation/validation.utils';

type AiCrawlerListError =
  AdminInsufficientPermissionsError | DatabaseError | ValidationError;

// DECISION (nie usuwaj tego komentarza):
// Math.trunc: page/page_size w DTO AiCrawlerListQuery/Response są integerami.
// Float w query (?page=1.9&page_size=2.999) NIE może wyciec do skip/take Prismy
// ani do echo w odpowiedzi (kontrakt DTO — klient liczy total/page_size i float
// rozsypuje page-count). Mirror coercePositiveInt z admin.utils.api.ts (audit-trail
// half); osobny helper bo ten endpoint ma własną ścieżkę paginacji (page_size, nie
// limit; default 50 / max 200 / hard cap page 10000). Number(...)||default łapie
// NaN/0; truncate PRZED clamp, by 200.9 → 200 (nie 201) i 0.5 → default.
const coercePositiveInt = (value: number | string | undefined): number => {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const sanitizeQuery = (
  raw: Partial<AiCrawlerListQuery>
): AiCrawlerListQuery => {
  // DECISION (nie usuwaj tego komentarza):
  // Hard cap page=10000 — chroni przed huge OFFSET DoS (page=999999 → Postgres
  // skanuje miliony rekordów). 10000 * 200 (max page_size) = 2M rekordów,
  // realistyczny upper bound dla AI crawler events przez kilka lat.
  const page = Math.max(1, Math.min(10000, coercePositiveInt(raw.page) || 1));
  const page_size = Math.min(
    AI_CRAWLER_MAX_PAGE_SIZE,
    Math.max(
      1,
      coercePositiveInt(raw.page_size) || AI_CRAWLER_DEFAULT_PAGE_SIZE
    )
  );
  // DECISION (nie usuwaj tego komentarza):
  // cleanAdminFilter (strip NUL + trim -> null gdy puste) lustrzy hardening kursora
  // event-loga: NUL (U+0000) w bot_name/path/date NIE moze trafic do Prisma where
  // (Postgres text odrzuca NUL -> niezmapowany 500). Malformowany filtr degraduje do
  // braku filtra (null), nie 5xx. bot_category dodatkowo zawezone narrowerem.
  const rawBotCategory = cleanAdminFilter(raw.bot_category);
  return {
    page,
    page_size,
    bot_category:
      rawBotCategory !== null && isAiCrawlerBotCategoryNarrower(rawBotCategory)
        ? rawBotCategory
        : null,
    bot_name: cleanAdminFilter(raw.bot_name),
    path: cleanAdminFilter(raw.path),
    from_date: cleanAdminFilter(raw.from_date),
    to_date: cleanAdminFilter(raw.to_date),
  };
};

/**
 * Parse ISO 8601 date. Returns null when invalid — caller treats null as "no bound".
 * Poza-zakresowa dla PostgreSQL data też daje null (patrz DECISION przy
 * `parsePgSafeDate`): inaczej filtr dat wywracał listę nieprzezroczystym 500.
 */
const parseIsoDate = (value: string | null): Date | null =>
  value === null ? null : parsePgSafeDate(value);

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LAST_MS_OF_DAY = TIME.MS_PER_DAY - 1;

/**
 * Upper bound of the date filter. A bare day („2026-10-09”, what the admin
 * date field sends) means the WHOLE day: parsed alone it is that day's first
 * millisecond, so `lte` dropped every event of the chosen day and „Do daty”
 * excluded the day it named (found in S126). A full timestamp stays exact.
 * Same reading as `utcDayEnd` in admin-logs.operations.ts.
 */
export const parseInclusiveEndDate = (value: string | null): Date | null => {
  const parsed = parseIsoDate(value);
  if (parsed === null || value === null || !DAY_ONLY.test(value)) {
    return parsed;
  }
  return new Date(parsed.getTime() + LAST_MS_OF_DAY);
};

export const adminGetAiCrawlerList_IO = async ({
  currentUser,
  query,
}: {
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
  query: Partial<AiCrawlerListQuery>;
}): Promise<OperationResult<AiCrawlerListResponse, AiCrawlerListError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    const sanitized = sanitizeQuery(query);
    const { page, page_size } = sanitized;
    const skip = (page - 1) * page_size;

    const fromDate = parseIsoDate(sanitized.from_date ?? null);
    const toDate = parseInclusiveEndDate(sanitized.to_date ?? null);

    if (fromDate !== null && toDate !== null && fromDate > toDate) {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'date_range',
        message: 'from_date must be <= to_date',
      });
    }

    const where: Prisma.AiCrawlerEventWhereInput = {};
    if (sanitized.bot_category) {
      where.bot_category = sanitized.bot_category;
    }
    if (sanitized.bot_name) {
      where.bot_name = sanitized.bot_name;
    }
    if (sanitized.path) {
      where.path = sanitized.path;
    }
    if (fromDate !== null || toDate !== null) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (fromDate !== null) {
        createdAt.gte = fromDate;
      }
      if (toDate !== null) {
        createdAt.lte = toDate;
      }
      where.created_at = createdAt;
    }

    const [items, total] = await Promise.all([
      DB_CLIENT.use.aiCrawlerEvent.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip,
        take: page_size,
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
      DB_CLIENT.use.aiCrawlerEvent.count({ where }),
    ]);

    return success({
      items: items.map(item => ({
        ...item,
        bot_category:
          item.bot_category !== null
            ? narrowAiCrawlerBotCategory(item.bot_category)
            : null,
      })),
      total,
      page,
      page_size,
    });
  } catch (error) {
    return databaseFailure('adminGetAiCrawlerList', error);
  }
};
