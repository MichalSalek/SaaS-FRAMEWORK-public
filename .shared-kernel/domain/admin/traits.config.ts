// SSOT: Valid trait categories for admin trait management

export const TRAIT_CATEGORIES = [
  'technique',
  'finish',
  'decoration',
  'style',
] as const;
export type TraitCategoryValue = (typeof TRAIT_CATEGORIES)[number];
