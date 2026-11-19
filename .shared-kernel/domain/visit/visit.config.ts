import { countCodePoints } from '../../policies/validation/validation.utils';

export const VISIT_CONFIG = Object.freeze({
  SERVICE_NOTE_MAX: 1000,
  RESULT_PHOTOS_MAX_PER_VISIT: 30,
  CRM_NOTE_MAX: 10000,
  /** Older clients clamp at this size and cannot safely edit longer persisted notes. */
  CRM_NOTE_LEGACY_MAX: 2000,

  /**
   * „Ważne przed wizytą”: the one thing the stylist must not miss (an allergy, a sensitivity).
   *
   * DECISION: short on purpose (owner): it is read at a glance on the session screen
   * and the notes list, so it is one line, not a second CRM note. The column is VARCHAR(200);
   * raising this needs a migration (SCHEMA_DECISIONS.md#pair-important-note).
   */
  IMPORTANT_NOTE_MAX: 200,

  /**
   * Sufit ręcznie dopisanych wizyt na JEDNĄ parę stylistka-klientka.
   *
   * DECISION: visit creation was gated by plan and an active pair but by nothing else, so a client card
   * could grow without bound (each entry carries a note up to 1000 chars and up to 30 photos). The
   * limit is deliberately very high: it is a barrier against a loop (buggy client, script), not a
   * product regulator. A client visited weekly for ten years is about 520 visits, so 2000 is out of
   * reach for real use; hitting it means rethinking the model (archiving old visits), not raising it.
   */
  MAX_VISITS_PER_PAIR: 2000,

  /**
   * How many expired sessions of one client the client card lists below the visit history.
   *
   * DECISION: an expired session leaves no visit record (nothing confirms the visit happened, and the
   * client would see it among her visits), so the card reads the sessions themselves, folded below
   * the visits (owner). Newest first, within the plan's history window; a client who lets
   * more than this many sessions expire is not the case the list is for.
   */
  EXPIRED_SESSIONS_MAX: 20,
} as const);
/** System appends may exceed the manual cap; edits can retain or shrink that persisted baseline. */
export const getCrmNoteEditLimit = (
  existingNote: string | null | undefined
): number =>
  Math.max(VISIT_CONFIG.CRM_NOTE_MAX, countCodePoints(existingNote ?? ''));
