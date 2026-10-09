/**
 * SessionContainer — concurrency helpers (R8, finding session-container-1).
 *
 * Groups the per-session write-serialization concern surfaced by QA:
 *   1. lockSessionContainerRow — pessimistic row-lock (SELECT ... FOR UPDATE) on the
 *      OWNING SessionContainer row, taken FIRST inside addPhotoToSessionContainer_IO's
 *      $transaction. This serializes all concurrent photo inserts for ONE session so the
 *      `max(position)+1` allocation can never collide on @@unique([session_id, position]).
 *      Kills the retry-exhaustion 500 + silent photo-loss (finding session-container-1):
 *      under heavy contention (≥6 parallel) competing TXs used to read the SAME nextPosition
 *      under READ COMMITTED, fight over P2002, and the late contenders exhausted MAX_RETRIES
 *      → databaseFailure(max-retries) → 500 with the photo dropped. With the lock, inserts
 *      queue and each reads the COMMITTED max — collision-free, deterministic.
 *   2. isConcurrencyConflict — detect a transient transaction-abort (deadlock SQLSTATE 40P01
 *      OR serialization failure 40001) so the add-photo catch RETRIES it (like P2002-position)
 *      instead of letting it fall through to an unmapped 500. Belt-and-suspenders: the single
 *      lock order (session row first) makes 40P01 effectively impossible from this path, and
 *      READ COMMITTED never raises 40001 — but if any unforeseen path produces one, the retry
 *      absorbs it.
 *
 * The lock MUST be called INSIDE the active interactive `$transaction` (tx) — the row lock
 * lives until that transaction commits/rolls back.
 */

import type { Prisma } from '../../../prisma/js-client';
import { isSerializationConflict } from '@app/db/serialization-conflict';
import { isDeadlock } from '@app/db/prisma-error';
import { hasCode } from '@kernel/models/type_narrowing';

export type LockedSessionContainer = {
  id: string;
};

// DECISION (nie usuwaj tego komentarza) — STRUKTURALNA detekcja P2002, NIE instanceof
// (finding session-container-3): pod Turbopack `error instanceof
// Prisma.PrismaClientKnownRequestError` zwraca FALSE mimo że error.constructor.name ===
// 'PrismaClientKnownRequestError' (zdublowane tożsamości klasy między realizacjami modułu —
// ten sam powód, dla którego serialization-conflict.ts unika instanceof). Sprawdzamy
// `error.code === 'P2002'` przez współdzielony `hasCode` narrower (kernel) — odporne na
// re-wrapping i bundling. Czyste type-narrowing, zero `any`/`!`.
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

// DECISION (nie usuwaj tego komentarza) — P2002 constraint discriminator (finding session-container-3,
// rozszerzony po cross-model review GPT-5.5 r1b: distinguish ALL THREE unique constraints, NIE catch-all):
// Pod @prisma/adapter-pg v7.x `error.meta.target` jest UNDEFINED dla unique-constraintów trafianych
// w add-photo (zwerifikowane empirycznie probe'em na żywej DB):
//   • partial-unique `session_container_active_pair_uq` (raw-SQL index z ensure-db-indexes.ts —
//     Prisma go NIE zna ze schema → meta.target pusty),
//   • `@@unique([session_id, position])` (`SessionContainerPhoto_session_id_position_key`),
//   • `@@unique([session_id, gallery_record_id])` (`SessionContainerPhoto_session_id_gallery_record_id_key`).
// Stary `error.meta.target.includes('position'|'active_pair')` był MARTWY (target===undefined
// → targetStr==='undefined' → żadna gałąź nie łapała) → active_pair leciał do databaseFailure → 500
// zamiast 429 MAX_ACTIVE_EXCEEDED; nawet position-retry nie odpalał (maskowane przez row-lock, który
// czyni kolizję pozycji nieosiągalną w praktyce). Autorytatywne źródło nazwy constraintu pod adapter-pg
// to `error.meta.driverAdapterError.cause` = { originalCode:'23505', originalMessage:'... unique
// constraint "<index_name>"', kind:'UniqueConstraintViolation', constraint:{ fields:[...] } }. UWAGA:
// dla UNIQUE-violation (23505) `constraint` ma `fields` (nazwy kolumn z pg `detail`), NIE `index` —
// `{index}` istnieje tylko dla FK-violation (23503) w adapterze. Dlatego klasyfikujemy po NAZWIE indeksu
// z originalMessage (najprecyzyjniej) + fallback po `fields`:
//   position:        [session_id, "position"]                 (drugie pole = "position"),
//   duplicate_photo: [session_id, gallery_record_id]          (drugie pole = gallery_record_id),
//   active_pair:     [client_account_id, stylist_account_id].
// position vs duplicate_photo dzielą `session_id` jako PIERWSZE pole — dyskryminujemy po DRUGIM polu
// (position vs gallery_record_id), wzajemnie wykluczającym, więc kolejność tych dwóch gałęzi jest
// nieistotna dla poprawności (żadne pole nie pasuje do obu). Czyste type-narrowing, zero `any`/`!`.
const ACTIVE_PAIR_INDEX_NAME = 'session_container_active_pair_uq';
const POSITION_INDEX_NAME = 'SessionContainerPhoto_session_id_position_key';
const DUPLICATE_PHOTO_INDEX_NAME =
  'SessionContainerPhoto_session_id_gallery_record_id_key';

// DECISION (nie usuwaj tego komentarza) — pola `unknown`, NIE `string`/`string[]`
// (cross-model review GPT-5.5): `readAdapterViolationCause` robi tylko `typeof object`
// checki i rzutuje surowy, NIEWALIDOWANY ksztalt adapter-pg. Deklarowanie tu
// `originalMessage: string` / `fields: string[]` KLAMALOBY — wartosci nie sa runtime-
// sprawdzone. Trzymamy je `unknown`, by punkt uzycia (classifyUniqueConstraintViolation)
// MUSIAL je zwalidowac przed `.includes`/`.map` (inaczej throw wewnatrz catcha add-photo).
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
 * Classify a P2002 unique-constraint violation surfaced inside add-photo. Reads
 * the adapter-pg raw cause (meta.target is empty for these indexes — see the
 * DECISION above) and matches by index name, falling back to constraint fields.
 * Caller decides routing: `position` → retry, `duplicate_photo` → idempotent
 * success (photo already in container), `active_pair` → per-client cap (429),
 * `other`/`unknown` → generic DB error (NOT a fabricated 429).
 */
export const classifyUniqueConstraintViolation = (
  error: unknown
): ViolatedUniqueConstraint => {
  const cause = readAdapterViolationCause(error);
  if (cause === null) {
    return 'unknown';
  }

  // DECISION (nie usuwaj tego komentarza) — DEFENSIVE SHAPE-GUARD (cross-model review GPT-5.5):
  // `cause.originalMessage` / `cause.constraint.fields` sa typu `unknown` (niezaufany ksztalt
  // adapter-pg). Gdyby adapter kiedykolwiek zwrocil message nie-stringiem albo fields nie-tablica
  // (lub tablica z nie-stringami), surowe `message.includes(...)` / `fields.map(f => f.replace(...))`
  // RZUCILYBY WEWNATRZ catcha add-photo (catch-in-catch → unmapped 500) zamiast spasc do
  // generycznego databaseFailure. Walidujemy runtime: nie-string message => '', nie-`string[]`
  // fields => [] (filtrujac nie-stringi). Przy nieoczekiwanym ksztalcie zaden branch nizej nie
  // matchuje => zwracamy 'other' => caller routuje do databaseFailure (NIGDY 429/retry). Zero `any`/`!`.
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

// DECISION (nie usuwaj tego komentarza) — per-session write-serializer (finding session-container-1):
// PESYMISTYCZNY row-lock (SELECT ... FOR UPDATE) na OWNING wierszu SessionContainer, brany
// JAKO PIERWSZA instrukcja w transakcji addPhotoToSessionContainer_IO, ZANIM przeczytamy
// max(position) i wstawimy SessionContainerPhoto. Powod: @@unique([session_id, position])
// wymusza gesty porzadek, a `max(position)+1` czytany pod READ COMMITTED nie blokuje
// konkurencyjnych insertow — dwie wspolbiezne TX wybieraly TEN SAM nextPosition, biły się o
// P2002, a pozni rywale wyczerpywali MAX_RETRIES → databaseFailure(max-retries) → 500 ze
// zgubionym zdjeciem (potwierdzone QA: 12 rownoleglych → 8×500). Lock serializuje wszystkich
// piszacych do TEJ sesji w JEDNEJ kolejnosci: insert czeka na lock, po jego zwolnieniu czyta
// JUZ skommitowany max(position) → kolizja niemozliwa, retry zbedny (deterministyczna
// eliminacja, nie P2002-retry-loop jako glowny mechanizm). Lock zalezy TYLKO od jednego
// wiersza (session) → brak cyklu, deadlock niemozliwy z tej sciezki. Nazwa tabeli/kolumny:
// SessionContainer NIE ma @@map → fizyczna tabela "SessionContainer", kolumna "id" (PascalCase
// nazwa tabeli ⇒ cudzyslowy wymagane w Postgres; kolumna "id" lowercase, ale cytowana dla
// spojnosci). Zwracamy lekki { id } — nie potrzebujemy reszty wiersza, fresh-state i tak czyta
// osobny select nizej. Zero `any`/`!`.
export const lockSessionContainerRow = async (
  tx: Prisma.TransactionClient,
  sessionId: string
): Promise<LockedSessionContainer | null> => {
  const rows = await tx.$queryRaw<LockedSessionContainer[]>`
    SELECT "id"
      FROM "SessionContainer"
      WHERE "id" = ${sessionId}
      FOR UPDATE`;

  return rows[0] ?? null;
};

// DECISION (nie usuwaj tego komentarza) — transient-conflict detektor (finding session-container-1):
// Laczy deadlock (SQLSTATE 40P01) i serialization-failure (40001) w JEDEN predykat retry-able przez
// delegacje do dwoch wspoldzielonych app-layer detektorow, ZERO lokalnej duplikacji:
//   - 40001 → isSerializationConflict (@app/db/serialization-conflict — SSOT ksztaltu adapter-pg
//     DriverAdapterError: name/cause.kind/message/stack),
//   - 40P01 → isDeadlock (@app/db/prisma-error — SSOT detektora deadlock; poprzednia lokalna kopia
//     40P01 wypromowana TUTAJ, zgodnie z zapowiedzia tego komentarza "gdy ktos polaczy oba detektory
//     w jeden shared util, ta kopia znika"; ten sam detektor uzywa moderation isDeadlockError i
//     favorite-remove deadlock-retry).
// Po row-locku wyzej oba sa effectively-nieosiagalne z tej sciezki (single lock order + READ
// COMMITTED) — to defence-in-depth: gdyby cokolwiek nieprzewidzianego rzucilo transient-abort,
// add-photo catch RETRYUJE go (jak P2002-position) zamiast oddac unmapped 500. Zero `any`/`!`.
export const isConcurrencyConflict = (error: unknown): boolean =>
  isSerializationConflict(error) || isDeadlock(error);
