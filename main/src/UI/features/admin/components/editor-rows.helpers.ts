// admin/components/editor-rows.helpers.ts
// Height of the text field of the notes and policies editors, in rows.
//
// A fixed tall field put the editor's buttons under the fold on a phone, even
// for a one-line note. The field starts short and grows with its text; a
// native textarea has no responsive `rows`, so the count comes from the text.

/** Characters assumed per visual line: a phone-width field holds about this many. */
const CHARS_PER_LINE = 36;

export function estimateEditorRows(
  text: string,
  min: number,
  max: number
): number {
  const lines = text
    .split('\n')
    .reduce(
      (total, line) =>
        total + Math.max(1, Math.ceil(line.length / CHARS_PER_LINE)),
      0
    );
  // One spare line, so there is always room to keep writing.
  return Math.min(max, Math.max(min, lines + 1));
}
