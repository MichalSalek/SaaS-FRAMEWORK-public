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

// DECISION: page/page_size are integers in the DTO, so a float query (?page=1.9) must not reach
// Prisma skip/take or the echoed response (the client derives the page count from it). Truncate BEFORE
// the clamp so 200.9 becomes 200, not 201. Own copy of admin.utils.api.ts coercePositiveInt because
// this endpoint paginates by page_size, not limit.
const coercePositiveInt = (value: number | string | undefined): number => {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const sanitizeQuery = (
  raw: Partial<AiCrawlerListQuery>
): AiCrawlerListQuery => {
  // DECISION: hard cap page=10000 against huge-OFFSET scans; 10000 × max page_size (200) = 2M rows,
  // a realistic upper bound for crawler events.
  const page = Math.max(1, Math.min(10000, coercePositiveInt(raw.page) || 1));
  const page_size = Math.min(
    AI_CRAWLER_MAX_PAGE_SIZE,
    Math.max(
      1,
      coercePositiveInt(raw.page_size) || AI_CRAWLER_DEFAULT_PAGE_SIZE
    )
  );
  // cleanAdminFilter strips NUL and trims to null: Postgres text rejects NUL (unmapped 500), so a
  // malformed filter degrades to no filter; bot_category is also narrowed.
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
 * A date out of PostgreSQL range also gives null (see the DECISION at `parsePgSafeDate`);
 * otherwise a date filter crashed the list with an opaque 500.
 */
const parseIsoDate = (value: string | null): Date | null =>
  value === null ? null : parsePgSafeDate(value);

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LAST_MS_OF_DAY = TIME.MS_PER_DAY - 1;

/**
 * Upper bound of the date filter. A bare day („2026-10-09”, what the admin
 * date field sends) means the WHOLE day: parsed alone it is that day's first
 * millisecond, so `lte` dropped every event of the chosen day and „Do daty”
 * excluded the day it named. A full timestamp stays exact.
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
