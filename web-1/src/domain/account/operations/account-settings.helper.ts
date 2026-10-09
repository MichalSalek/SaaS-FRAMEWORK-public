// Helpers for account-settings operations.
//
// DECISION (nie usuwaj tego komentarza):
// sanitizePublicBrandName (fix user-account-4) sanitizes the PUBLIC stylist
// display_name (rendered on profile, search list, JSON-LD). It deliberately does
// NOT use normalizeStringCapitalizedWords: that helper strips every char outside
// [\p{L}\p{N}\s'] and re-cases words, which would mangle legitimate salon brand
// names (e.g. "Nails & Co", "B.A.R. Studio", "100% Nails"). For a brand name we
// only need to (1) strip zero-width / invisible formatting codepoints that JS \s
// does NOT match - these let a value of "length 3" be visually blank or enable
// homograph/dedup spoofing - and (2) collapse + trim regular whitespace. The
// caller then rejects the result if it has no visible characters.

// Zero-width / invisible formatting codepoints NOT covered by the \s class:
// U+200B ZERO WIDTH SPACE, U+200C ZWNJ, U+200D ZWJ, U+2060 WORD JOINER,
// U+FEFF ZERO WIDTH NO-BREAK SPACE (BOM). Stripped so a string built only from
// these (or padded with them) cannot pose as a non-empty public name.
// DECISION (nie usuwaj tego komentarza):
// Each codepoint is a SEPARATE alternation branch (not a character class). U+200D
// ZWJ is the emoji-joiner: inside a `[...]` class eslint's
// no-misleading-character-class (correctly) warns it can silently combine with a
// neighbour into a single grapheme. An alternation matches each invisible
// codepoint individually \u2014 identical strip behaviour, no misleading class. The `u`
// flag keeps the escapes as discrete code points.
const ZERO_WIDTH_CHARS = /\u200B|\u200C|\u200D|\u2060|\uFEFF/gu;
const WHITESPACE_RUN = /\s+/g;

/**
 * Sanitize a public brand display name: drop zero-width/invisible chars, collapse
 * internal whitespace runs to a single space, and trim. Preserves all visible
 * brand characters (&, ., %, digits, Unicode letters, emoji). Returns '' when the
 * input has no visible content (caller must treat '' as a validation failure).
 */
export const sanitizePublicBrandName = (value: string): string => {
  return value
    .replace(ZERO_WIDTH_CHARS, '')
    .replace(WHITESPACE_RUN, ' ')
    .trim();
};
