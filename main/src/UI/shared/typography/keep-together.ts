// UI/shared/typography/keep-together.ts
// Finds the pieces of a sentence that must stay on one line: a hint in
// parentheses, a number with its unit, a short head before a hyphen
// („E-Mail”, „QR-Code”). The list mirrors the BREAK rule of the alignment
// probe (`scripts/qa-alignment-probe.cjs`), which is the measure of „done”.
//
// No lookbehind in the expression (older Safari does not parse it and the
// whole bundle would fail to start): the hyphen case checks the character
// before the match in code instead.

export interface TextPiece {
  text: string;
  /** `true`: the piece must not break inside. */
  keep: boolean;
}

const UNIT = '(?:zł|PLN|EUR|€|%|MB|px|dni|min|Tage|Tagen|days)';
const PIECE = new RegExp(
  [
    '\\([^()]{2,40}\\)', // (min 1, max 3)
    `\\d[\\d .,]*[ \\u00a0]?${UNIT}(?!\\p{L})`, // 79 zł, 30 dni
    '\\p{L}{1,2}-\\p{L}{3,}', // E-Mail: the short head never ends a line
  ].join('|'),
  'gu'
);
const SHORT_HEAD = /^\p{L}{1,2}-/u;
const WORD_CHARACTER = /[\p{L}\d-]/u;

/** `text` cut into plain runs and pieces that must stay whole, in order. */
export function splitUnbreakablePieces(text: string): TextPiece[] {
  const pieces: TextPiece[] = [];
  let last = 0;
  for (const match of text.matchAll(PIECE)) {
    const start = match.index ?? 0;
    const found = match[0];
    // „Gellack-Maniküre”: the expression also matches „ck-Maniküre”; a head
    // that continues a longer word is not a short head.
    const before = start > 0 ? (text[start - 1] ?? '') : '';
    if (SHORT_HEAD.test(found) && WORD_CHARACTER.test(before)) {
      continue;
    }
    if (start > last) {
      pieces.push({ text: text.slice(last, start), keep: false });
    }
    pieces.push({ text: found, keep: true });
    last = start + found.length;
  }
  if (last < text.length) {
    pieces.push({ text: text.slice(last), keep: false });
  }
  return pieces;
}
