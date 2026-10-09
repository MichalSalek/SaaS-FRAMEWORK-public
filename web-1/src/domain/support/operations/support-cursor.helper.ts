import { DB_CLIENT } from '@app/db/db.client';
import type { Prisma } from '../../../prisma/js-client';
import { isValidCursorFormat } from '@kernel/policies/validation/validation.utils';

/**
 * Shared cursor-pagination resolution for SupportThread list queries (user + admin).
 *
 * DECISION (nie usuwaj tego komentarza): SSOT dla format-gate'a + existence-fallback cursora
 * (finding support-1). Wcześniej user-endpoint (getSupportThreads_IO) miał tę logikę inline,
 * a admin-endpoint (adminGetAllThreads_IO) NIE — well-formed-but-unknown cursor cicho zwracał
 * pustą stronę zamiast złożyć się do pierwszej. Wyciągnięte tu, bo to dokładnie ten sam
 * dwuetapowy kontrakt (gate → ownership/existence) i dwa call-site'y = rule-of-three próg
 * abstrakcji (RULE OF THREE / SSOT). Helper NIE woła samego query — zwraca decyzję
 * `useCursor`, a caller składa Prisma cursor-spread, więc każdy zachowuje swój własny `select`
 * / `orderBy` / `take`.
 *
 * Dwa etapy (mirror gallery-explore SSOT):
 *  1. Format-gate: null-byte (\0)/non-cuid cursor → `{ invalid: true }`. Caller zwraca
 *     VALIDATION_ERROR 400. Bez gate'a taki cursor rzucałby w findFirst/findMany → niezmapowany
 *     500. Odrzuca WYŁĄCZNIE wartości, które nigdy nie są legalnym cuid (więc niczyim id) —
 *     brak ryzyka enumeration.
 *  2. Existence-check: poprawnie sformatowany cursor MUSI istnieć w zestawie callera
 *     (`where` = ten sam filtr co główne query). Nieistniejący/obcy cursor pozycjonowałby
 *     Prisma względem nieobecnego wiersza (orderBy id desc + skip:1) i CICHO gubił stronę.
 *     Strategia: IGNORUJEMY (fallback do pierwszej strony, `useCursor:false`), NIE błąd —
 *     jednolita odpowiedź "obcy" vs "nieistniejący" = brak enumeration; cursory są
 *     server-issued (nextCursor), legalny klient nigdy tu nie trafi obcego.
 */
export type SupportCursorResolution =
  { invalid: true } | { invalid: false; useCursor: boolean };

export const resolveSupportThreadCursor = async (
  cursor: string | undefined,
  where: Prisma.SupportThreadWhereInput
): Promise<SupportCursorResolution> => {
  if (cursor !== undefined && !isValidCursorFormat(cursor)) {
    return { invalid: true };
  }

  if (cursor === undefined || cursor === '') {
    return { invalid: false, useCursor: false };
  }

  const owned =
    (await DB_CLIENT.use.supportThread.findFirst({
      where: { id: cursor, ...where },
      select: { id: true },
    })) !== null;

  return { invalid: false, useCursor: owned };
};
