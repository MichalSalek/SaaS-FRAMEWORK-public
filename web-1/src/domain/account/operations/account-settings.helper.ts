// Helpers for account-settings operations.
//
// DECISION: the public display_name is NOT run through normalizeStringCapitalizedWords, which
// strips everything outside [\p{L}\p{N}\s'] and re-cases words, mangling real brand names
// ("Nails & Co", "B.A.R. Studio", "100% Nails"). We only strip invisible codepoints that \s does
// not match (they make a "length 3" name blank or spoofable) and collapse whitespace; the caller
// rejects a result with no visible characters.

// Zero-width / invisible formatting codepoints NOT covered by the \s class:
// U+200B ZERO WIDTH SPACE, U+200C ZWNJ, U+200D ZWJ, U+2060 WORD JOINER,
// U+FEFF ZERO WIDTH NO-BREAK SPACE (BOM). Stripped so a string built only from
// these (or padded with them) cannot pose as a non-empty public name.
// Alternation, not a character class: ZWJ inside `[...]` trips no-misleading-character-class.
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
