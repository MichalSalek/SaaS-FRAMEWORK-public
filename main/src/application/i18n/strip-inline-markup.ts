/**
 * Removes inline pseudo-tag markup (`<tag>`, `</tag>`, `<tag/>`) from an i18n
 * string, keeping the inner text intact.
 *
 * next-intl rich messages carry placeholders like
 * `<compareLink>Zobacz porównanie</compareLink>` that the *visible* UI renders
 * as real elements (an `<a>`) via `t.rich`. When the same raw message string is
 * materialised into structured data (JSON-LD `text`/`name`) or SEO meta at build
 * time, those pseudo-tags have no renderer and would leak verbatim into
 * `application/ld+json`, polluting rich results / AI answers.
 *
 * Generic by design: strips ANY tag-shaped substring, so future i18n keys that
 * gain inline markup cannot silently leak into structured data. A bare "<" that
 * does not form a tag (e.g. "cena < 50") is preserved — the pattern requires a
 * leading letter (optionally after "/") so only real tag markup is removed.
 */
export function stripInlineMarkup(value: string): string {
  return value.replace(/<\/?[a-zA-Z][^>]*>/g, '');
}
