/**
 * Removes inline pseudo-tag markup (`<tag>`, `</tag>`, `<tag/>`) from an i18n string, keeping the
 * inner text.
 *
 * next-intl rich messages carry placeholders like `<compareLink>Zobacz porównanie</compareLink>`
 * that the UI renders via `t.rich`. Materialised into JSON-LD or SEO meta at build time they have no
 * renderer and would leak verbatim into `application/ld+json`.
 *
 * Generic by design: strips ANY tag-shaped substring. A bare "<" that is not a tag (e.g.
 * "cena < 50") is preserved: the pattern needs a leading letter (optionally after "/").
 */
export function stripInlineMarkup(value: string): string {
  return value.replace(/<\/?[a-zA-Z][^>]*>/g, '');
}
