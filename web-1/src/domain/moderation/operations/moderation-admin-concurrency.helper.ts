/**
 * Moderation admin — concurrency helpers.
 *
 * Extracted from moderation-admin.operations.ts to keep the operation under the
 * max-lines budget and to group the two concurrency concerns surfaced by QA
 * (admin-state-cascade-l2-1 deadlock):
 *   1. lockStylistAccountRow — deterministic single serialization point (kills the
 *                              resolve-report deadlock cycle, finding l2-1).
 *   2. isDeadlockError       — detect SQLSTATE 40P01 (defence-in-depth → 409, finding l2-1).
 *
 * Both MUST be called INSIDE the active interactive `$transaction` (tx) — the row
 * lock lives until that transaction commits/rolls back.
 *
 * NOTE: the floored cached_gallery_count writer moved to gallery (gallery owns that counter):
 * gallery/operations/gallery-count.helper.ts → decrementGalleryCountFloored / incrementGalleryCount.
 * Moderation imports it FROM gallery; this file keeps only the lock + deadlock-detector concern.
 */

import type { Prisma } from '../../../prisma/js-client';
import { isDeadlock } from '@app/db/prisma-error';

export type LockedStylistAccount = {
  account_id: string;
};

// DECISION (nie usuwaj tego komentarza) — resolve-report deadlock 40P01 (finding admin-state-cascade-l2-1):
// PESYMISTYCZNY row-lock (SELECT ... FOR UPDATE) na WSPÓLNYM wierszu StylistAccount, brany
// JAKO PIERWSZY w transakcji resolveContentReport_IO, ZANIM zapiszemy jakikolwiek wiersz
// ContentReport. Powód: dwa współbieżne resolve na siblingowych raportach tego samego konta
// tworzyły cykl — każda tx locka NAJPIERW własny ContentReport (update self), POTEM przez
// resolveRelatedReports updateMany sięga po wiersz raportu, który trzyma DRUGA tx → A-czeka-B /
// B-czeka-A → Postgres abortuje ofiarę z 40P01 (opaque 500, zgubiona akcja moderacji).
// StylistAccount to JEDYNY wspólny przodek WSZYSTKICH raportów konta (scope 'record' I 'account':
// gallery_record → created_by_account_id), więc lock na nim serializuje WSZYSTKICH piszących
// to konto w JEDNEJ kolejności — cykl niemożliwy, retry zbędny (deterministyczna eliminacja,
// nie Serializable+P2034-retry). Kto pierwszy weźmie lock, przechodzi w całości; reszta czeka i
// po jego commicie czyta JUŻ skommitowany status (caller re-czyta status PENDING po locku →
// przegrany dostaje czysty CONTENT_REPORT_ALREADY_RESOLVED zamiast 500/silent no-op).
// Nazwa tabeli/kolumn: StylistAccount NIE ma @@map → fizyczna tabela "StylistAccount", kolumna
// "account_id" (PascalCase ⇒ cudzysłowy wymagane w Postgres). Zero `any`/`!`.
export const lockStylistAccountRow = async (
  tx: Prisma.TransactionClient,
  accountId: string
): Promise<LockedStylistAccount | null> => {
  const rows = await tx.$queryRaw<LockedStylistAccount[]>`
    SELECT "account_id"
      FROM "StylistAccount"
      WHERE "account_id" = ${accountId}
      FOR UPDATE`;

  return rows[0] ?? null;
};

export type LockedUser = {
  id: string;
};

// DECISION (nie usuwaj tego komentarza) — GLOBALNY INWARIANT KOLEJNOSCI LOCKOW: User → StylistAccount.
// KAZDY multi-row pisarz dotykajacy obu tabel bierze lock NAJPIERW na User, POTEM na StylistAccount:
// disableUser_IO / disableSelfUser_IO / softDeleteAccount_IO / reactivateAccount_IO / enableUser_IO
// (user-state.operations.ts + user-soft-delete.operations.ts) oraz admin-bulk-disable/enable
// (admin-bulk.operations.ts). resolveContentReport_IO BAN dotyka TYCH SAMYCH dwoch wierszy (User owner
// + StylistAccount), wiec MUSI trzymac te sama kolejnosc — inaczej BAN (S→U) deadlockuje (40P01) z
// kazdym User-first disable/enable/delete TEJ SAMEJ stylistki (cykl ABBA: BAN trzyma S czeka U, disable
// trzyma U czeka S; PG auto-abortuje ofiare → nieobsluzone 500). Ten helper bierze pesymistyczny
// row-lock (SELECT ... FOR UPDATE) na wierszu User wlasciciela ZANIM resolveContentReport_IO wezmie
// lockStylistAccountRow, przywracajac globalna kolejnosc U→S. NIE narusza serializacji l2-1: lock na
// StylistAccount nadal pada PRZED jakimkolwiek zapisem ContentReport (jedyna gwarancja, ktorej wymaga
// lockStylistAccountRow); dodatkowy lock User PRZED nim tylko zacieśnia serializacje (BAN↔BAN tej samej
// stylistki ida przez U), nie tworzac nowego cyklu (HIDE/DELETE nie lockuja User → nie czekaja na nic,
// co BAN trzyma). Brany TYLKO dla BAN (HIDE/DELETE nie dotykaja User). Nazwa tabeli: User ma
// @@map("users") (wymog Better Auth) → fizyczna tabela "users"; kolumna "id" (brak @map). Wolany WEWNATRZ
// aktywnej interaktywnej $transaction (lock zyje do commit/rollback). Zero `any`/`!`.
export const lockUserRow = async (
  tx: Prisma.TransactionClient,
  userId: string
): Promise<LockedUser | null> => {
  const rows = await tx.$queryRaw<LockedUser[]>`
    SELECT "id"
      FROM "users"
      WHERE "id" = ${userId}
      FOR UPDATE`;

  return rows[0] ?? null;
};

// DECISION (nie usuwaj tego komentarza) — SQLSTATE 40P01 deadlock detektor (finding admin-state-cascade-l2-1):
// kanoniczny structural detektor mieszka teraz w application/db/prisma-error.ts (isDeadlock) — JEDEN
// detektor 40P01 dla web-1, współdzielony z session-container (isConcurrencyConflict) i favorite-remove
// deadlock-retry (favorite-records.operations.ts, remove vs moderation-DELETE ABBA). Tu re-eksport pod
// nazwą domenową, by call-site resolve-report + kontekst defence-in-depth zostały lokalne: po
// deterministycznym locku (lockStylistAccountRow) cykl resolve-report jest WYELIMINOWANY, więc użycie
// isDeadlockError w resolveContentReport_IO to belt-and-suspenders (gdyby nieprzewidziana ścieżka i tak
// zacykliła, ofiara dostaje semantyczne 409/ALREADY_RESOLVED — concurrent moderacja już wygrała =
// raport faktycznie rozwiązany — zamiast opaque 500). isSerializationConflict łapie 40001 — INNY błąd.
export const isDeadlockError = isDeadlock;
