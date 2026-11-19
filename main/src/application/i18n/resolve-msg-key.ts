import type { IntlMessages } from '../../types/i18n';
import { stripInlineMarkup } from './strip-inline-markup';

/**
 * Resolves a nested message key (dot-notation) to its string value.
 * Returns the key itself as a fallback if the path is not found or the
 * leaf value is not a string. Used by `getStaticProps` to materialise
 * SEO/JSON-LD payloads from i18n messages at build time.
 *
 * DECISION: the resolved value goes through `stripInlineMarkup` because this helper is used
 * EXCLUSIVELY for build-time SEO/JSON-LD/meta payloads (visible HTML uses next-intl `t`/`t.rich`).
 * i18n rich messages carry pseudo-tags (e.g. `<compareLink>…</compareLink>`) that render as real
 * elements in the UI but would leak verbatim into `application/ld+json` / `<meta>`. Stripping at
 * the source guarantees no current or future key can leak inline markup into structured data; the
 * `key` fallback and plain seo.* strings contain no tags, so it is a no-op there.
 */
export function resolveMsgKey(messages: IntlMessages, key: string): string {
  const parts = key.split('.');
  let current: unknown = messages;
  for (const part of parts) {
    if (current !== null && typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  return typeof current === 'string' ? stripInlineMarkup(current) : key;
}
