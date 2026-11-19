/**
 * Blog categories — SSOT for category slugs and their i18n keys.
 * Category display names are in i18n: pages.blog.categories.<slug>
 */

export const BLOG_CATEGORIES = [
  'seasonal-trends',
  'tips-for-stylists',
  'how-to-guides',
  'business-salon',
  'product-updates',
  'inspiration',
] as const;

export type BlogCategory = (typeof BLOG_CATEGORIES)[number];
