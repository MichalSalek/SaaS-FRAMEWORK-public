// Pure presentation helpers of the notes screen (unit-tested).

/** Longest excerpt a row shows; the whole note is on the screen the row opens. */
export const NOTE_EXCERPT_MAX = 160;

/**
 * One-paragraph excerpt of a note: line breaks fold into spaces and a long note
 * is cut at the last word boundary before the limit, with an ellipsis.
 */
export function noteExcerpt(note: string, max = NOTE_EXCERPT_MAX): string {
  const flat = note.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) {
    return flat;
  }
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const head = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${head.replace(/[\s,.;:]+$/, '')}…`;
}

/** Whether the „show it on your profile” offer applies (one-time bridge). */
export function shouldOfferNoteAsBio({
  generalNote,
  description,
  answered,
}: {
  generalNote: string | null;
  description: string | null;
  answered: boolean;
}): boolean {
  return (
    !answered &&
    (generalNote?.trim() ?? '') !== '' &&
    (description?.trim() ?? '') === ''
  );
}

/**
 * A date is one unbreakable piece („21 paź 2026” never splits across lines):
 * its spaces become no-break spaces. Row descriptions are plain strings, so
 * the piece cannot be wrapped in a nowrap element there.
 */
export function keepWhole(text: string): string {
  return text.replace(/ /g, '\u00A0');
}
