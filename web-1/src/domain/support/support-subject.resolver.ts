import { SUPPORT_LENGTHS } from '@kernel/policies/validation.config';

const collapseWhitespace = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

/** Cut to `max` UTF-16 units without leaving half of a surrogate pair behind. */
const cutTo = (value: string, max: number): string => {
  if (value.length <= max) {
    return value;
  }
  const cut = value.slice(0, max);
  const lastUnit = cut.charCodeAt(cut.length - 1);
  const endsOnHighSurrogate = lastUnit >= 0xd800 && lastUnit <= 0xdbff;
  return (endsOnHighSurrogate ? cut.slice(0, -1) : cut).trimEnd();
};

/**
 * Title of a support thread, derived from its first message.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Since S126 the user picks a CATEGORY and writes one message; nobody types a
 * subject. `SupportThread.subject` stays NOT NULL and stays the title of the
 * thread in every list, header and e-mail, so the server derives it: the first
 * line of the trimmed message with whitespace collapsed, cut to
 * SUPPORT_LENGTHS.SUBJECT_MAX. A first line shorter than SUBJECT_MIN ("Hi",
 * "?") says nothing, so the start of the WHOLE collapsed message is used
 * instead. The validator guarantees at least MESSAGE_MIN trimmed characters,
 * which always collapses to SUBJECT_MIN or more, so the result is never empty
 * for a validated message.
 */
export const deriveSupportSubject = (message: string): string => {
  const trimmed = message.trim();
  const firstLine = collapseWhitespace(trimmed.split(/\r?\n/, 1)[0] ?? '');
  const source =
    firstLine.length >= SUPPORT_LENGTHS.SUBJECT_MIN
      ? firstLine
      : collapseWhitespace(trimmed);
  return cutTo(source, SUPPORT_LENGTHS.SUBJECT_MAX);
};
