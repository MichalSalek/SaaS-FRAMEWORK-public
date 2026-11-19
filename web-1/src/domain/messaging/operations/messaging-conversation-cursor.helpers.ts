import { parsePgSafeDate } from '@kernel/policies/validation/validation.utils';

/** Composite date/id cursor, scoped by each inbox branch. */
export function conversationCursorWhere(cursor?: string) {
  // Composite keyset cursor "isoDate|pairId": tiebreaker po pair.id domyka
  // data-loss (dwie pary z tym samym last_message_at ms gubiłyby jedną na
  // granicy strony przy samym `lt` na dacie — closing-review MEDIUM).
  let cursorDate: Date | null = null;
  let cursorPairId = '';
  if (cursor != null && cursor.length > 0) {
    const sep = cursor.lastIndexOf('|');
    const isoPart = sep >= 0 ? cursor.slice(0, sep) : cursor;
    cursorPairId = sep >= 0 ? cursor.slice(sep + 1) : '';
    // A cursor outside the PostgreSQL range is unparseable (first page), not a
    // failure. Such a value used to reach Prisma and come back as 500, so one
    // query parameter produced an unbounded series of error-store rows and alerts.
    const parsed = parsePgSafeDate(isoPart);
    if (parsed !== null) {
      cursorDate = parsed;
    }
  }
  // Keyset WHERE (kolejność last_message_at DESC, id DESC): starsze od kursora
  // = (lmt < cursor) LUB (lmt = cursor AND id < cursorId). Warunki na
  // last_message_at wykluczają null (Prisma null-semantyka lt) — dla braku
  // kursora dajemy explicit { not: null }.
  return cursorDate != null
    ? {
        OR: [
          { last_message_at: { lt: cursorDate } },
          { last_message_at: cursorDate, id: { lt: cursorPairId } },
        ],
      }
    : { last_message_at: { not: null } };
}
