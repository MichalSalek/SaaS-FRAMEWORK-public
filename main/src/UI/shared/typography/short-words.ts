// UI/shared/typography/short-words.ts
// Polish typesetting: a one-letter word („w”, „i”, „z”, „a”, „o”, „u”) never
// ends a line; it travels with the word after it.
//
// DECISION: CSS cannot keep a short word with the next one, so the space after
// it becomes a no-break space, applied only when prose is DRAWN (TypographyAtom),
// never in translation files or the message loader: the same strings feed label
// search, SEO markup and the clipboard, where an NBSP is a bug. No lookbehind in
// the regex: older Safari cannot parse it and the whole bundle would fail.

const SHORT_WORDS = new Set(['a', 'i', 'o', 'u', 'w', 'z']);
const NBSP = ' ';
// Opening marks a short word may stand right after: („w galerii”), (i dalej).
const LEADING_MARKS = /^[(„"'«]+/;

/** `text` with every space after a one-letter word replaced by a hard space. */
export function keepShortWordsWithNext(text: string): string {
  if (!text.includes(' ')) {
    return text;
  }
  const words = text.split(' ');
  let result = words[0] ?? '';
  for (let index = 1; index < words.length; index += 1) {
    const previous = (words[index - 1] ?? '').replace(LEADING_MARKS, '');
    const next = words[index] ?? '';
    const glue =
      SHORT_WORDS.has(previous.toLowerCase()) && next !== '' ? NBSP : ' ';
    result += glue + next;
  }
  return result;
}

// A name with a short head before a hyphen („E-Mail-Versand”, „e-mail”) must
// not leave „E-” alone at the line end. A word joiner after the hyphen forbids
// the break and has no width, so the glyphs stay the same (the non-breaking
// hyphen U+2011 comes from another face here and sits 1px off).
//
// DECISION: NOT wired into TypographyAtom. An invisible character inside a word
// would reach the public pages' HTML that search engines read; use it only on
// logged-in screens where `qa:align` found a break (public pages use
// KeepTogetherTextAtom).
const WORD_JOINER = '\u2060';

/** `text` with a word joiner after every hyphen that stands between letters. */
export function keepHyphenatedTogether(text: string): string {
  if (!text.includes('-')) {
    return text;
  }
  return text.replace(/(\p{L})-(?=\p{L})/gu, `$1-${WORD_JOINER}`);
}
