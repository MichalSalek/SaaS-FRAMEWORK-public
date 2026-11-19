// UI/features/shared/reviews/reviewQuote.helpers.ts
// The last sentence of a review and everything before it. The reviews are
// quoted verbatim, so this never rewrites: it only finds the boundary.

interface SplitQuote {
  /** Everything before the last sentence (may be empty). */
  lead: string;
  /** The last sentence, with its closing mark. */
  last: string;
}

const SENTENCE_END = new Set(['.', '!', '?', '…']);

export function splitLastSentence(quote: string): SplitQuote {
  const text = quote.trim();
  // The boundary is a sentence mark followed by a space, searched from the
  // end and skipping the mark that closes the quote itself. No lookbehind:
  // older Safari does not parse it.
  for (let index = text.length - 2; index > 0; index -= 1) {
    const mark = text[index - 1];
    if (text[index] === ' ' && mark !== undefined && SENTENCE_END.has(mark)) {
      return { lead: text.slice(0, index).trim(), last: text.slice(index + 1) };
    }
  }
  return { lead: '', last: text };
}
