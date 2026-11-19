import type { LocaleType } from '@kernel/domain/i18n/i18n.config';

// DECISION: each locale has its own comparison post, not a translation: the tools and
// prices differ per market (Booksy Boost exists in Poland, not in Germany). So
// /compare links to the post written for the page's language.
export const COMPARE_BLOG_POST_SLUG: Readonly<Record<LocaleType, string>> = {
  pl: 'aplikacje-dla-stylistek-paznokci-2026',
  en: 'best-nail-portfolio-apps-2026',
  de: 'nagelstudio-apps-vergleich-2026',
};

/* Splits a headline into the lead plus the keyword (gold accent in the ink panel).
 * The period stays outside the accent: gold punctuation reads as a mistake.
 * Extracted from ComparePage.composition (max-lines 300). */
export function splitKeyword(headline: string): {
  lead: string;
  keyword: string;
  trailing: string;
} {
  const words = headline.trim().split(' ');
  const last = words.at(-1) ?? headline.trim();
  const trailingMatch = last.match(/[.!?…]+$/);
  const trailing = trailingMatch ? trailingMatch[0] : '';
  return {
    lead: words.slice(0, -1).join(' '),
    keyword: trailing ? last.slice(0, -trailing.length) : last,
    trailing,
  };
}
