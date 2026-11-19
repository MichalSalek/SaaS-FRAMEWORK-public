import { SupportThreadCategoryValue } from '../../models/support/support.dto';
import type { SupportThreadCategory } from '../../models/support/support.dto';

/**
 * Narrower for values that arrive as plain strings (query string of the admin
 * support list, URL of the admin support page). The enum itself is the
 * Prisma-generated SSOT (SupportThreadCategoryValue). The list filter's `NONE`
 * bucket is a query codec on the support contract, not a second guard here.
 */
export const isSupportThreadCategory = (
  value: unknown
): value is SupportThreadCategory =>
  typeof value === 'string' &&
  (Object.values(SupportThreadCategoryValue) as readonly string[]).includes(
    value
  );
