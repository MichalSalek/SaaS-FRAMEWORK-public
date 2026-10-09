import {
  SUPPORT_CATEGORY_FILTER_NONE,
  SupportThreadCategoryValue,
} from '../../models/support/support.dto';
import type {
  SupportThreadCategory,
  SupportThreadCategoryFilter,
} from '../../models/support/support.dto';

/**
 * Narrowers for values that arrive as plain strings (query string of the admin
 * support list, URL of the admin support page). The enum itself is the
 * Prisma-generated SSOT (SupportThreadCategoryValue).
 */
export const isSupportThreadCategory = (
  value: unknown
): value is SupportThreadCategory =>
  typeof value === 'string' &&
  (Object.values(SupportThreadCategoryValue) as readonly string[]).includes(
    value
  );

/** A category, or `NONE` for threads created before categories existed. */
export const isSupportThreadCategoryFilter = (
  value: unknown
): value is SupportThreadCategoryFilter =>
  value === SUPPORT_CATEGORY_FILTER_NONE || isSupportThreadCategory(value);
