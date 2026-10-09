// UI/features/support/supportCategory.helpers.ts
// Category of a support request on the user side: the order of the select and
// the narrowing of the `?category=` deep link. The enum is the Prisma-generated
// SSOT; its declaration order is the order the owner listed the options in.

import {
  SupportThreadCategoryValue,
  type SupportThreadCategory,
} from '@kernel/models/support/support.dto';
import { isSupportThreadCategory } from '@kernel/domain/support/support-category.config';

export const SUPPORT_CATEGORIES: readonly SupportThreadCategory[] =
  Object.values(SupportThreadCategoryValue);

/**
 * `?category=<value>` of the new-request screen. Anything that is not exactly
 * one known category (missing, repeated, wrong case, made up) means "nothing
 * preselected": the user picks herself.
 */
export function readCategoryParam(
  value: string | string[] | undefined
): SupportThreadCategory | null {
  return isSupportThreadCategory(value) ? value : null;
}
