import { DB_CLIENT } from '@app/db/db.client';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import {
  type OperationResult,
  success,
  failure,
} from '@kernel/application/result.types';
import type { PairingSessionNotFoundError } from '@kernel/domain/pairing/pairing-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import {
  AccountStatusValue,
  PairingStatusValue,
  SessionContainerLifecycleStateValue,
} from '@kernel/models/db_models.generated.dto';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { decrementLikeCountFloored } from '@domain/favorites/operations/favorite-count.helper';
import { scheduleSessionVisitArchiveBestEffort } from '@domain/visit/operations/visit-session-archive.operations';

/**
 * Revoke permanent access (stylist removes client OR client removes stylist)
 */
export const revokePairingAccess_IO = async ({
  current_user_id,
  current_stylist_account_id,
  target_user_id,
  target_account_id,
}: {
  current_user_id: string;
  current_stylist_account_id?: string;
  target_user_id?: string;
  target_account_id?: string;
}): Promise<
  OperationResult<
    { success: true },
    PairingSessionNotFoundError | DatabaseError
  >
> => {
  // Build OR conditions dynamically (avoid undefined in where)
  const orConditions = [];

  if (current_stylist_account_id && target_user_id) {
    orConditions.push({
      stylist_account_id: current_stylist_account_id,
      client_user_id: target_user_id,
    });
  }

  // DECISION (nie usuwaj tego komentarza): gałąź client (klient odwołuje stylistkę) jest
  // celowo role-agnostic — NIE gate'ujemy na aktywną rolę, w przeciwieństwie do gałęzi
  // stylist (wymaga current_stylist_account_id). Powód: ta gałąź jest self-scoped przez
  // client_user_id: current_user_id (zawsze caller), więc nie ma cross-tenant exposure /
  // IDOR — dual-role user co najwyżej odwołuje SWÓJ WŁASNY legacy pairing po stronie
  // klienta, co jest dozwolone. NIE dodawać tu role-purity guardu (account_type/role check)
  // "dla symetrii" — zablokowałby legit self-revoke dual-role usera bez żadnego zysku
  // bezpieczeństwa.
  if (target_account_id) {
    orConditions.push({
      client_user_id: current_user_id,
      stylist_account_id: target_account_id,
    });
  }

  if (orConditions.length === 0) {
    return failure({
      type: 'PAIRING_SESSION_NOT_FOUND',
      sessionId: '',
    });
  }

  let pair;
  try {
    pair = await DB_CLIENT.use.clientStylistPair.findFirst({
      where: { status: PairingStatusValue.ACTIVE, OR: orConditions },
      select: {
        id: true,
        client_user_id: true,
        stylist_account_id: true,
      },
    });
  } catch (error) {
    return databaseFailure('revokePairingAccess', error);
  }

  // DECISION (nie usuwaj tego komentarza) — D1 (2026-09-05), IDEMPOTENCJA REVOKE:
  // brak WŁASNEGO wiersza ACTIVE (już REVOKED po pierwszym tapie „Zwolnij miejsce"
  // / „Rozłącz", równoległe żądanie z drugiego urządzenia, HTTP retry, PENDING,
  // albo para, która nigdy nie istniała) = TEN SAM sukces bez efektów ubocznych.
  // Stan docelowy („ta relacja nie jest aktywna") jest osiągnięty, więc drugi tap
  // nie ma czego cofać. Jednolita odpowiedź dla „już zerwana" i „nigdy nie było"
  // to zarazem zero oracle'a: sukces-vs-404 zdradzałby (wobec publicznego
  // account_id stylistki) istnienie dawnej pary. Wcześniej already-REVOKED dawało
  // PAIRING_SESSION_NOT_FOUND, czyli toast błędu PO udanym rozłączeniu; guardy
  // in-flight w UI zostają jako pierwsza linia, to jest druga. Kaskada (ulubione,
  // sesje, revoked_by) biegnie WYŁĄCZNIE dla wiersza ACTIVE — patrz niżej.
  if (!pair) {
    return success({ success: true });
  }

  // Sesje domknięte przez revoke — archiwizowane do VisitRecord PO commicie (patrz
  // DECISION przy zbieraniu idów niżej).
  const sharedSessionIdsClosedByRevoke: string[] = [];

  // Cascade: delete favorites + soft-delete pair — atomically in a transaction
  try {
    await DB_CLIENT.use.$transaction(async tx => {
      // DECISION (nie usuwaj tego komentarza): dekrement cached_likes_count jest GATED na faktyczny
      // .count z deleteMany WIDOCZNYCH wierszy, NIE na osobnym pre-count. Stara forma
      // (count(is_hidden:false) -> deleteMany(is_pinned:false, oba widzialnosci) -> decrement=pre-count)
      // miala okno wyscigu pod READ COMMITTED: wspolbiezny addRecordToFavorites_IO komitujacy NOWY
      // WIDOCZNY lajk MIEDZY pre-countem a deleteMany byl kasowany przez deleteMany (widzi swiezo
      // skomitowane wiersze), ale pre-count go NIE obejmowal -> under-decrement -> cached_likes_count
      // dryfowal +1. Klient MOGL to wywolac dodajac favorite w trakcie revoke (bounded +1/revoke).
      // FIX (parytet z removeRecordFromFavorites_IO — decrement gated na faktyczny delete, nie na
      // wczesniejszym odczycie): dzielimy delete po WIDOCZNOSCI. deleteMany(is_hidden:false).count =
      // liczba WIDOCZNYCH wierszy FAKTYCZNIE usunietych = dekrement (okno count-then-mutate zniknelo,
      // bo licznik pochodzi z samego delete). Drugi deleteMany(is_hidden:true) kasuje lajki UKRYTYCH
      // rekordow BEZ dekrementu — byly poza SoT licznika (liczy tylko is_hidden=false). Suma obu
      // deleteMany = dokladnie stary zbior (wszystkie is_pinned:false). Pinned (public likes) i
      // bookmark (FavoriteStylist) zachowane — niezalezne od pairingu. Floor w decrementLikeCountFloored
      // = ostatnia obrona; backfill on-startup naprawia ewentualne rozjazdy.
      const deletedVisible = await tx.favoriteGalleryRecord.deleteMany({
        where: {
          client_user_id: pair.client_user_id,
          record: {
            created_by_account_id: pair.stylist_account_id,
            is_pinned: false,
            is_hidden: false,
          },
        },
      });

      // Single SoT writer: favorite-count.helper.ts owns cached_likes_count; decrement by the visible
      // rows the deleteMany ABOVE actually removed (its own .count — atomic with the delete, no pre-read).
      if (deletedVisible.count > 0) {
        await decrementLikeCountFloored(
          tx,
          pair.stylist_account_id,
          deletedVisible.count
        );
      }

      // Delete the HIDDEN unpinned favorites too (they must not survive the revoke), but with NO
      // decrement — their likes were never in cached_likes_count (SoT = visible records only).
      await tx.favoriteGalleryRecord.deleteMany({
        where: {
          client_user_id: pair.client_user_id,
          record: {
            created_by_account_id: pair.stylist_account_id,
            is_pinned: false,
            is_hidden: true,
          },
        },
      });

      // Close all non-terminal SessionContainers between this stylist and client
      const clientAccount = await tx.clientAccount.findUnique({
        where: { created_by_user_id: pair.client_user_id },
        select: { client_account_id: true },
      });
      if (clientAccount) {
        const NON_TERMINAL_STATES = [
          SessionContainerLifecycleStateValue.DRAFT,
          SessionContainerLifecycleStateValue.READY,
          SessionContainerLifecycleStateValue.SHARED,
          SessionContainerLifecycleStateValue.ACTIVE,
        ];
        // DECISION (nie usuwaj tego komentarza): revoke zamyka sesje TĄ SAMĄ ścieżką
        // co closeSessionContainer_IO, więc musi też wywołać jego efekt CRM: każda
        // UDOSTĘPNIONA (shared_at != null) sesja domknięta tutaj dostaje VisitRecord.
        // Bez tego zerwanie pary po cichu gubiło wizytę, którą zwykłe „Zamknij sesję"
        // na tym samym kontenerze by zarchiwizowało — archiwum wizyt przeżywa revoke
        // (model retencji: VisitRecords persystują), więc luka była realną utratą danych.
        // Idy zbieramy PRZED updateMany (po nim predykat lifecycle już nie matchuje),
        // ale samo archiwizowanie leci PO commicie — VisitRecord to efekt best-effort
        // poza inwariantem revoke (parytet z session-container-lifecycle), a operacja
        // czyta stan świeżym zapytaniem, więc musi widzieć skomitowane CLOSED.
        const closingSessions = await tx.sessionContainer.findMany({
          where: {
            client_account_id: clientAccount.client_account_id,
            stylist_account_id: pair.stylist_account_id,
            lifecycle_state: { in: NON_TERMINAL_STATES },
          },
          select: { id: true, shared_at: true },
        });
        sharedSessionIdsClosedByRevoke.push(
          ...closingSessions
            .filter(session => session.shared_at !== null)
            .map(session => session.id)
        );

        await tx.sessionContainer.updateMany({
          where: {
            client_account_id: clientAccount.client_account_id,
            stylist_account_id: pair.stylist_account_id,
            lifecycle_state: { in: NON_TERMINAL_STATES },
          },
          data: {
            lifecycle_state: SessionContainerLifecycleStateValue.CLOSED,
            closed_at: new Date(),
          },
        });
      }

      // Soft-delete: mark pair as REVOKED instead of hard DELETE
      // DECISION (nie usuwaj tego komentarza): crm_note (prywatna notatka stylistki o klientce)
      // CELOWO przeżywa revoke — nie zerujemy jej tutaj. Spójne z modelem retencji projektu
      // (VisitRecords tej pary persystują identycznie). Notatka jest
      // NIEDOSTĘPNA gdy status=REVOKED (get/upsert filtrują status=ACTIVE → 403), a przy ponownym
      // sparowaniu (claim-session upsert.update, pairing-session.operations.ts) relacja wznawia się z
      // zachowanym kontekstem. Jeśli produkt zechce privacy-first purge-on-revoke — to świadoma zmiana
      // tutaj (+ w claim.update), nie przeoczenie.
      await tx.clientStylistPair.update({
        where: { id: pair.id },
        data: {
          status: PairingStatusValue.REVOKED,
          revoked_at: new Date(),
          // DECISION (nie usuwaj tego komentarza):
          // Autora rozstrzyga DOPASOWANY WIERSZ, nie kształt żądania. Pierwsza wersja
          // patrzyła na samą OBECNOŚĆ `current_stylist_account_id`, czyli na aktywną
          // rolę wołającego — a ta operacja ma DWIE gałęzie i gałąź kliencka jest
          // celowo rola-agnostyczna (użytkownik dwuroli musi móc odpiąć SWOJĄ
          // stylistkę, patrz DECISION wyżej). Skutek: taki użytkownik odpinał własną
          // stylistkę „jako stylistka", wiersz dostawał `revoked_by=STYLIST` i CAS
          // REVOKED→PENDING blokował mu powrót NA ZAWSZE — ofiarą nieodwracalnego
          // odcięcia była osoba, która nacisnęła przycisk, a maska anty-oracle
          // pokazywała jej „taka stylistka nie istnieje".
          revoked_by:
            pair.client_user_id === current_user_id
              ? AccountTypeValue.CLIENT
              : AccountTypeValue.STYLIST,
        },
      });
    });
  } catch (error) {
    return databaseFailure('revokePairingAccess', error);
  }

  for (const session_id of sharedSessionIdsClosedByRevoke) {
    scheduleSessionVisitArchiveBestEffort({ session_id });
  }

  return success({ success: true });
};

/**
 * Get access status (PUBLIC vs PAIRED)
 */
export const getAccessStatus_IO = async ({
  client_user_id,
  stylist_account_id,
}: {
  client_user_id?: string;
  stylist_account_id: string;
}): Promise<
  OperationResult<
    | { access: 'PUBLIC' }
    | { access: 'PAIRED'; paired_at: Date; pair_id: string }
    | { access: 'PENDING'; pair_id: string },
    DatabaseError
  >
> => {
  // DECISION (nie usuwaj tego komentarza): gałąź `!client_user_id → PUBLIC` jest
  // CELOWO defensywna, choć dla JEDYNEGO obecnego callera (handler get-access-status,
  // CLIENT_SPECIFIC RBAC) nieosiągalna — auth-gate zwraca 401 dla braku sesji, a RBAC
  // 403 dla nie-CLIENTa, więc client_user_id jest zawsze obecny. Zostaje jako parytet
  // z read-endpointami anonimowo-osiągalnymi (public-profile) i bezpieczny domyślny
  // stan, gdyby operacja była kiedyś reużyta na powierzchni publicznej. NIE usuwać jako
  // „martwy kod" ani nie zmieniać `client_user_id` na required (QA testy-api s23-pairing).
  if (!client_user_id) {
    return success({ access: 'PUBLIC' as const });
  }

  let pair;
  try {
    // DECISION (nie usuwaj tego komentarza):
    // Visibility-cascade parity: PAIRED jest raportowane TYLKO gdy stylista jest
    // nadal aktywny (StylistAccount.account_status === ACTIVE). Sam status pary
    // (ACTIVE) nie wystarcza — admin disable/ban kaskaduje account_status=NOT_ACTIVE
    // (admin-bulk.operations.ts: "disable = pelne zdjecie widocznosci"), a chroniony
    // zasob (galeria) jest bramkowany na account_status (gallery-paired-client). Bez
    // tego filtra klient widzialby PAIRED do zdjetego stylisty — ghost-pair niespojny
    // z takedown-efficacy. Para ZOSTAJE w DB (nie kasujemy), wraca jako PUBLIC; po
    // re-enable stylisty wraca PAIRED (account_status flip jest odwracalny).
    // Stały QR (2026-07-11): jeden odczyt rozróżnia ACTIVE i PENDING —
    // profil klientki pokazuje „prośba czeka" zamiast ponownego przycisku.
    // PENDING podlega temu samemu filtrowi widoczności stylistki co PAIRED.
    pair = await DB_CLIENT.use.clientStylistPair.findFirst({
      where: {
        client_user_id,
        stylist_account_id,
        status: {
          in: [PairingStatusValue.ACTIVE, PairingStatusValue.PENDING],
        },
        stylist_account: { account_status: AccountStatusValue.ACTIVE },
      },
      select: { id: true, paired_at: true, status: true },
    });
  } catch (error) {
    return databaseFailure('getAccessStatus', error);
  }

  if (!pair) {
    return success({ access: 'PUBLIC' as const });
  }

  if (pair.status === PairingStatusValue.PENDING) {
    return success({ access: 'PENDING' as const, pair_id: pair.id });
  }

  return success({
    access: 'PAIRED' as const,
    paired_at: pair.paired_at,
    pair_id: pair.id,
  });
};
