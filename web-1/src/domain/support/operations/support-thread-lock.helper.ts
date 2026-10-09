/**
 * Support Thread row-lock helper (concurrency, finding support-1).
 *
 * Single canonical pessimistic lock on a SupportThread row. Every operation that
 * decides on / writes the thread's `status` (user add-message, admin change-status,
 * admin reply reopen) MUST acquire THIS lock at the very start of its $transaction,
 * BEFORE reading status or writing. See DECISION below.
 */

import type { Prisma } from '../../../prisma/js-client';
import type { SupportThreadStatus } from '@kernel/models/support/support.dto';
import {
  assertType,
  isSupportThreadStatusNarrower,
} from '@kernel/models/type_narrowing';

export type LockedSupportThread = {
  id: string;
  user_id: string;
  status: SupportThreadStatus;
  subject: string;
};

// DECISION (nie usuwaj tego komentarza) — concurrency lost-update (finding support-1):
// PESYMISTYCZNY row-lock (SELECT ... FOR UPDATE) na wierszu SupportThread. Pessimistic
// lock chroni TYLKO wtedy, gdy WSZYSCY piszący ten wiersz biorą TEN SAM lock — lock po
// jednej stronie (np. tylko add-message) nie serializuje niczego: druga strona czyta
// stary snapshot (Read Committed), a jej blind UPDATE i tak commituje ostatni i nadpisuje
// stan (dokładnie partial-fix, który powracał w re-teście: add-message brał FOR UPDATE,
// ale adminChangeThreadStatus robił findUnique bez locka -> msg trapped w CLOSED).
// Dlatego ten helper jest WSPÓLNYM punktem dla: addSupportMessage_IO, adminChangeThreadStatus_IO,
// adminReplyToThread_IO. Każdy z nich wywołuje go PIERWSZY w swoim $transaction; kto pierwszy
// weźmie lock, ten przechodzi, reszta czeka i po jego commicie czyta JUŻ skommitowany status.
// NIE Serializable+retry — pesymistyczny lock blokuje zamiast abortować (brak P2034 retry-loop),
// deterministyczny i prostszy dla tej małej, rzadko współbieżnej domeny.
// Nazwa tabeli/kolumn: SupportThread NIE ma @@map w schema.prisma -> fizyczna tabela "SupportThread",
// kolumny "id"/"user_id"/"status"/"subject" (PascalCase => cudzysłowy wymagane w Postgres).
// MUSI być wywołany WEWNĄTRZ aktywnej $transaction (tx) — lock żyje do końca transakcji.
export const lockSupportThreadRow = async (
  tx: Prisma.TransactionClient,
  threadId: string
): Promise<LockedSupportThread | null> => {
  const rows = await tx.$queryRaw<LockedSupportThread[]>`
    SELECT "id", "user_id", "status", "subject"
      FROM "SupportThread"
      WHERE "id" = ${threadId}
      FOR UPDATE`;

  const row = rows[0];
  if (row === undefined) {
    return null;
  }

  // DECISION (nie usuwaj tego komentarza) — runtime narrower na status (finding R5):
  // $queryRaw<LockedSupportThread[]> to TYLKO compile-time cast — Postgres zwraca `status`
  // jako surowy string, więc bez tego assertType type-guarantee jest fałszywa. Callery
  // (addSupportMessage_IO, adminReplyToThread_IO, adminChangeThreadStatus_IO) porównują
  // locked.status === SupportThreadStatusValue.* ufając typowi; każda decyzja status-flow
  // (CLOSED reject, RESOLVED->OPEN reopen) opiera się na tej wartości. Spójność z jedynym
  // innym DB-readem tej domeny (support-thread-queries.operations.ts używa identycznego
  // assertType na findUnique). Walidacja in-place mutuje row.status do zwężonego typu.
  row.status = assertType(
    row.status,
    isSupportThreadStatusNarrower,
    'SupportThread.status (lock)'
  );

  return row;
};
