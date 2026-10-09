import { DB_CLIENT } from '@app/db/db.client';
import { PairingStatusValue } from '@kernel/models/db_models.generated.dto';
import {
  type OperationResult,
  success,
} from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { PairRequestStylistNotFoundError } from '@kernel/domain/pairing/pairing-errors.types';

/**
 * Kształt odpowiedzi `createPairRequest_IO` + odczyt zwycięzcy wyścigu P2002.
 * Wydzielone z `pair-request.operations.ts`, bo plik dobił do swojego capu
 * `max-lines` — oba kawałki dotyczą TEGO, CO operacja oddaje wołającemu.
 */
export type PairRequestOutcome = {
  status: 'PENDING' | 'ALREADY_PAIRED';
  display_name: string | null;
  // true TYLKO przy realnym utworzeniu/reaktywacji prośby — audyt i licznik
  // lejka (PAIR_REQUEST_SENT / posthog) liczą wyłącznie created (Codex #9:
  // idempotentny re-POST nie może pompować funnela).
  created: boolean;
  // Wspólny klucz lejka PostHog (sent → accepted/declined) — Codex S51.
  // null tylko wtedy, gdy nawet re-read po wyścigu nie zdołał odczytać wiersza.
  pair_id: string | null;
  // Adresat maila „prośba czeka" — konsumowany przez endpoint przy
  // created=true (stały-only 2026-07-12), nie idzie do DTO klientki.
  notify: {
    stylist_user_id: string;
    stylist_email: string;
    stylist_name: string | null;
  } | null;
};

export type PairRequestResult = OperationResult<
  PairRequestOutcome,
  PairRequestStylistNotFoundError | DatabaseError
>;

/**
 * Odpowiedź przegranego wyścigu dwóch PIERWSZYCH próśb tej samej pary (dwa
 * urządzenia / HTTP retry): unique-violation to idempotentny sukces, nie 500.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Re-read po kluczu unikalnym (client, stylist) jest tu OBOWIĄZKOWY, nie
 * ozdobą: bez niego przegrany dostawał `pair_id: null` i `display_name: null`,
 * więc UI zostawało bez uchwytu do prośby (anulowanie, wspólny klucz lejka
 * PostHog) i bez nazwy salonu — a zwycięzca wiersz JUŻ zapisał. Jeden
 * indeksowany odczyt na ścieżce zachodzącej wyłącznie przy podwójnym POST.
 * Awaria samego re-readu NIE może zamienić idempotentnego sukcesu w 500,
 * dlatego catch spada do wariantu bez id zamiast propagować błąd.
 */
export const resolvePairRequestAfterUniqueRace = async ({
  client_user_id,
  stylist_account_id,
}: {
  client_user_id: string;
  stylist_account_id: string;
}): Promise<PairRequestResult> => {
  try {
    const winner = await DB_CLIENT.use.clientStylistPair.findUnique({
      where: {
        client_user_id_stylist_account_id: {
          client_user_id,
          stylist_account_id,
        },
      },
      select: {
        id: true,
        status: true,
        stylist_account: { select: { display_name: true } },
      },
    });
    if (winner) {
      return success({
        // Zwycięzca zakłada PENDING; ACTIVE jest osiągalne tylko wtedy, gdy claim
        // kodu podniósł parę tuż po nim — mapujemy jak re-read po przegranym CAS.
        status:
          winner.status === PairingStatusValue.ACTIVE
            ? ('ALREADY_PAIRED' as const)
            : ('PENDING' as const),
        display_name: winner.stylist_account.display_name,
        created: false,
        pair_id: winner.id,
        notify: null,
      });
    }
  } catch {
    // Patrz DECISION wyżej — brak re-readu degraduje odpowiedź, nie wywraca jej.
  }

  return success({
    status: 'PENDING' as const,
    display_name: null,
    created: false,
    pair_id: null,
    notify: null,
  });
};
