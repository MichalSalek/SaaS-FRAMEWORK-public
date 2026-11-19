const CATEGORY_LABEL_KEY = {
  'ai-training': 'category.aiTraining',
  'ai-search': 'category.aiSearch',
  'search-engine': 'category.searchEngine',
  'seo-tool': 'category.seoTool',
  social: 'category.social',
  unknown: 'category.unknown',
} as const;

export type CrawlerCategoryLabelKey =
  (typeof CATEGORY_LABEL_KEY)[keyof typeof CATEGORY_LABEL_KEY];

export function crawlerCategoryLabelKey(
  category: string
): CrawlerCategoryLabelKey | null {
  if (Object.prototype.hasOwnProperty.call(CATEGORY_LABEL_KEY, category)) {
    return CATEGORY_LABEL_KEY[category as keyof typeof CATEGORY_LABEL_KEY];
  }
  return null;
}

// DECISION: colour encodes data (the bot category), one per category, the same in the pill and the
// share bar. AI training uses ink, not the raspberry accent: raspberry belongs to the screen's main
// action, and its 12% tint made the pale pink the house style does not allow.
const CATEGORY_COLOR: Record<string, string> = {
  'ai-training': 'var(--color-text-primary)',
  'ai-search': 'var(--color-info)',
  'search-engine': 'var(--color-success)',
  'seo-tool': 'var(--color-warning)',
  social: 'var(--color-error)',
};

/** Role token of a bot category; unknown categories stay neutral. */
export function crawlerCategoryColor(category: string | null): string {
  return (
    (category === null ? undefined : CATEGORY_COLOR[category]) ??
    'var(--color-text-secondary)'
  );
}
