/**
 * lockSessionContainerRow takes FOR UPDATE on the session row first inside add-photo's
 * transaction, so each insert reads the committed max position. Without the lock, READ
 * COMMITTED readers share one nextPosition, lose on P2002 and exhaust retries into a 500.
 * isConcurrencyConflict retries 40P01 and 40001 the same way. Call the lock only inside
 * that transaction; it lasts until commit or rollback.
 * Test: session-container-concurrency.helper.test.ts (row-or-null and the classifier; not a live race).
 */

import { isSerializationConflict } from '@app/db/serialization-conflict';
import { lockSessionContainer } from '@app/db/lock-rows';
import { isDeadlock } from '@app/db/prisma-error';
import { hasCode } from '@kernel/models/type_narrowing';

// DECISION: P2002 is detected structurally via the kernel `hasCode` narrower, not with instanceof
// (see web-1/src/application/db/prisma-error.ts).
export const isP2002 = (error: unknown): boolean =>
  hasCode(error) && error.code === 'P2002';

/**
 * Which unique constraint a P2002 violated, classified from the raw adapter-pg
 * error shape. `position` = SessionContainerPhoto_session_id_position_key
 * (dense-ordering @@unique([session_id, position]) → row-lock-retry domain).
 * `duplicate_photo` = SessionContainerPhoto_session_id_gallery_record_id_key
 * (@@unique([session_id, gallery_record_id]) → idempotent-success domain: the
 * photo is already in the container). `active_pair` =
 * session_container_active_pair_uq (partial-unique, one live session per
 * client/stylist pair → MAX_ACTIVE_EXCEEDED domain). `other` = any OTHER unique
 * constraint surfaced unexpectedly on this path (→ generic DB error, NOT a
 * fabricated 429). `unknown` = a P2002 whose constraint could not be extracted
 * from the error.
 */
export type ViolatedUniqueConstraint =
  'position' | 'duplicate_photo' | 'active_pair' | 'other' | 'unknown';

const ACTIVE_PAIR_INDEX_NAME = 'session_container_active_pair_uq';
const POSITION_INDEX_NAME = 'SessionContainerPhoto_session_id_position_key';
const DUPLICATE_PHOTO_INDEX_NAME =
  'SessionContainerPhoto_session_id_gallery_record_id_key';

// DECISION: the fields are `unknown`, NOT `string`/`string[]`: `readAdapterViolationCause` only does `typeof object` checks
// and casts the raw UNVALIDATED adapter-pg shape. Declaring `originalMessage: string` / `fields: string[]` would lie, so
// they stay `unknown` and the use site (classifyUniqueConstraintViolation) MUST validate them before `.includes`/`.map`
// (otherwise a throw inside the add-photo catch).
type AdapterUniqueViolationCause = {
  originalMessage?: unknown;
  constraint?: { fields?: unknown; index?: unknown };
};

const readAdapterViolationCause = (
  error: unknown
): AdapterUniqueViolationCause | null => {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const meta = (error as Record<string, unknown>).meta;
  if (typeof meta !== 'object' || meta === null) {
    return null;
  }
  const dae = (meta as Record<string, unknown>).driverAdapterError;
  if (typeof dae !== 'object' || dae === null) {
    return null;
  }
  const cause = (dae as Record<string, unknown>).cause;
  if (typeof cause !== 'object' || cause === null) {
    return null;
  }
  return cause as AdapterUniqueViolationCause;
};

/**
 * Classify a P2002 unique-constraint violation surfaced inside add-photo. Reads the adapter-pg raw cause (meta.target is
 * empty for these indexes, see the discriminator DECISION above) and matches by index name, falling back to constraint
 * fields. Caller routing: `position` -> retry, `duplicate_photo` -> idempotent success (photo already in container),
 * `active_pair` -> per-client cap (429), `other`/`unknown` -> generic DB error (NOT a fabricated 429).
 */
export const classifyUniqueConstraintViolation = (
  error: unknown
): ViolatedUniqueConstraint => {
  const cause = readAdapterViolationCause(error);
  if (cause === null) {
    return 'unknown';
  }

  // DECISION: defensive shape guard. `cause.originalMessage` / `cause.constraint.fields` are `unknown` (untrusted adapter-pg
  // shape). If the adapter ever returned a non-string message or non-array fields (or an array with non-strings), a raw
  // `message.includes(...)` / `fields.map(f => f.replace(...))` would THROW inside the add-photo catch (catch-in-catch ->
  // unmapped 500) instead of falling to the generic databaseFailure. So a non-string message => '' and non-`string[]` fields
  // => [] (non-strings filtered); with an unexpected shape no branch below matches, it returns 'other', and the caller routes
  // to databaseFailure (NEVER 429/retry).
  const message: string =
    typeof cause.originalMessage === 'string' ? cause.originalMessage : '';
  const rawFields = cause.constraint?.fields;
  const fields: string[] = Array.isArray(rawFields)
    ? rawFields.filter((f): f is string => typeof f === 'string')
    : [];
  // pg quotes the reserved word `position` → it arrives as `"position"`; strip
  // surrounding quotes before comparing field names.
  const normalizedFields = fields.map(f => f.replace(/"/g, ''));

  if (
    message.includes(ACTIVE_PAIR_INDEX_NAME) ||
    (normalizedFields.includes('client_account_id') &&
      normalizedFields.includes('stylist_account_id'))
  ) {
    return 'active_pair';
  }

  // duplicate_photo BEFORE position: both indexes share `session_id` as the
  // first field, so the field-fallback must key on the SECOND field. The
  // duplicate-photo index is [session_id, gallery_record_id] — a P2002 here
  // means the same gallery record was added to this container twice (idempotent
  // re-add), which must NOT be mis-mapped to the per-client 429 cap. Match by
  // exact index name first, then by the gallery_record_id field.
  if (
    message.includes(DUPLICATE_PHOTO_INDEX_NAME) ||
    (normalizedFields.includes('session_id') &&
      normalizedFields.includes('gallery_record_id'))
  ) {
    return 'duplicate_photo';
  }

  if (
    message.includes(POSITION_INDEX_NAME) ||
    (normalizedFields.includes('session_id') &&
      normalizedFields.includes('position'))
  ) {
    return 'position';
  }

  return 'other';
};

// DECISION: lockSessionContainerRow is SELECT ... FOR UPDATE on the owning
// session row, taken before max(position)+1 and the photo insert.
// web-1/src/domain/session-container/operations/session-container-concurrency.helper.test.ts
// checks that mock returns a row or null. It does not insert two photos.
// web-1/src/application/db/lock-graph.test.ts finds no cycle for the modeled
// one-row addSessionPhoto shape. Cascade and FK locks
// are outside that model. The SQL lives in @app/db/lock-rows.
export const lockSessionContainerRow = lockSessionContainer;

// DECISION: the transient-conflict detector combines deadlock (SQLSTATE 40P01) and serialization failure (40001) into ONE
// retry-able predicate by delegating to two shared app-layer detectors, with no local duplication:
//   - 40001 -> isSerializationConflict (@app/db/serialization-conflict: the SSOT for the adapter-pg DriverAdapterError shape),
//   - 40P01 -> isDeadlock (@app/db/prisma-error: the SSOT deadlock detector, also used by moderation isDeadlockError and the
//     favorite-remove deadlock retry).
// If a 40P01 or 40001 is thrown, add-photo retries it. The helper test treats
// those shapes as retryable. It does not show they cannot occur.
export const isConcurrencyConflict = (error: unknown): boolean =>
  isSerializationConflict(error) || isDeadlock(error);
