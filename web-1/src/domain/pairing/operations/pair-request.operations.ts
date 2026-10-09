import { DB_CLIENT } from '@app/db/db.client';
import { TIME } from '@kernel/application/constants.config';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { ACTIVE_PAIR_FOR_CAP } from '@domain/pairing/pairing-cap.predicates';
import { PAIRING_CONFIG } from '@domain/pairing/pairing.config';
import { getPlanConfig } from '@app/pricing/plan-config.cache';
import {
  PRICING_POLICY,
  narrowPricingPlan,
} from '@kernel/policies/pricing.policy';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import {
  type OperationResult,
  success,
  failure,
} from '@kernel/application/result.types';
import type {
  PairingLimitReachedError,
  PairingTooManyActiveSessionsError,
  PairRequestNotFoundError,
} from '@kernel/domain/pairing/pairing-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { PairingStatusValue } from '@kernel/models/db_models.generated.dto';
import { USER_POLICY } from '@kernel/policies/user.policy';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { isSerializationConflict } from '@app/db/serialization-conflict';
import { isP2002 } from '@app/db/prisma-error';
import { PairingLimitExceededRollback } from './pairing-rollback.helper';
import {
  type PairRequestResult,
  resolvePairRequestAfterUniqueRace,
} from './pair-request.result';

/**
 * Prośba o połączenie ze stałego kodu QR / publicznego profilu (2026-07-11,
 * PAIRING_QR_ARCHITECTURE_BRAINSTORM): klientka tworzy parę PENDING — bez
 * ŻADNEGO dostępu (wszystkie ścieżki filtrują status=ACTIVE) — a stylistka
 * podnosi ją na ACTIVE jednym tapem (respondPairRequest_IO). Limity par NIE
 * są sprawdzane przy prośbie (PENDING nie zajmuje capów; twardy guard obu
 * capów działa przy ACCEPT — parytet z claim). Anty-spam niesie STRICT
 * rate-limit endpointu + unikalność (client, stylist).
 */
const PAIR_REQUEST_REASSERT_WINDOW_MS =
  PAIRING_CONFIG.REQUEST_REASSERT_WINDOW_MINUTES * TIME.MS_PER_MINUTE;

export const createPairRequest_IO = async ({
  client_user_id,
  stylist_account_id,
}: {
  client_user_id: string;
  stylist_account_id: string;
}): Promise<PairRequestResult> => {
  try {
    return await DB_CLIENT.use.$transaction(async tx => {
      const stylistAccount = await tx.stylistAccount.findUnique({
        where: { account_id: stylist_account_id },
        select: {
          display_name: true,
          created_by_user_id: true,
          account_status: true,
          // Dane pod mail „prośba czeka" (emitInfoEvent w endpoincie) — NIE
          // trafiają do RESPONSE klientki (PII stylistki zostaje na serwerze).
          created_by_user: {
            select: { email: true, name: true, is_active: true },
          },
        },
      });

      // Anty-oracle (parytet z claim): nieistniejąca / nieaktywna / WŁASNA
      // stylistka (dual-role self-pair) = jeden błąd NOT_FOUND, zero wycieku.
      // `is_active` sprawdzane JAWNIE, nie przez kaskadę: dziś soft-delete
      // i wyłączenie konta ustawiają `account_status` w tej samej transakcji,
      // więc bramka wyżej i tak by zadziałała — ale to zbieg okoliczności,
      // nie kontrakt. Druga strona tej samej reguły (ACCEPT w
      // respondPairRequest_IO i lista próśb) sprawdza żywotność konta wprost,
      // więc trzymamy parytet: gdyby kiedykolwiek pojawiła się ścieżka
      // wyłączająca usera bez ruszania statusu konta, prośba i tak nie
      // dotrze do nieżyjącego adresata (i nie wyśle mu maila).
      if (
        !stylistAccount ||
        !USER_POLICY.utils.IS_ACCOUNT_STATUS_ACTIVE(
          stylistAccount.account_status
        ) ||
        stylistAccount.created_by_user.is_active === false ||
        stylistAccount.created_by_user_id === client_user_id
      ) {
        return failure({
          type: 'PAIR_REQUEST_STYLIST_NOT_FOUND',
          stylistAccountId: stylist_account_id,
        });
      }

      const existing = await tx.clientStylistPair.findUnique({
        where: {
          client_user_id_stylist_account_id: {
            client_user_id,
            stylist_account_id,
          },
        },
        select: {
          id: true,
          status: true,
          revoked_by: true,
          // Czas POPRZEDNIEJ prośby — patrz DECISION o oknie ponowienia niżej.
          paired_at: true,
          // D2 (hide = mute): stylistka ukryła tę rozmowę → ponowna prośba nie
          // wysyła jej maila (patrz DECISION przy `notify` niżej).
          stylist_hidden_at: true,
        },
      });

      // Idempotencja: ACTIVE → „już połączone" (klientka skanuje plakat
      // salonu, z którym już jest sparowana); PENDING → prośba już czeka
      // (bez odświeżania paired_at — spam prośbami nie podbija pozycji).
      if (existing?.status === PairingStatusValue.ACTIVE) {
        return success({
          status: 'ALREADY_PAIRED' as const,
          display_name: stylistAccount.display_name,
          created: false,
          pair_id: existing.id,
          notify: null,
        });
      }
      if (existing?.status === PairingStatusValue.PENDING) {
        return success({
          status: 'PENDING' as const,
          display_name: stylistAccount.display_name,
          created: false,
          pair_id: existing.id,
          notify: null,
        });
      }

      if (existing) {
        // DECISION (nie usuwaj tego komentarza):
        // Zerwanie PO STRONIE STYLISTKI jest dla klientki NIEODWRACALNE. Wcześniej
        // ponowna prośba podnosiła KAŻDY wiersz REVOKED z powrotem do PENDING, a
        // `canSendToPair` dopuszcza PENDING — więc usunięta klientka jednym POST-em
        // odzyskiwała prawo pisania do skrzynki stylistki, w tym samym wątku.
        // „Usuń tę osobę" to jedyna kontrola, jaką stylistka ma nad tym, kto się z nią
        // kontaktuje, a cofała ją właśnie osoba usunięta (potwierdzone w runtime:
        // revoke → 403 na wiadomość → request-pair → 201 na wiadomość, w pętli).
        // Odmowa (DECLINE) zachowywała się tak samo, więc pętla nie miała końca, a
        // każdy obrót re-armował maila „prośba czeka".
        // Ponowne sparowanie zostaje możliwe, ale wyłącznie za ZGODĄ stylistki —
        // przez zeskanowanie jej kodu (claim sesji), nie jednostronnie.
        // Odpowiedź jest maskowana tym samym NOT_FOUND co nieistniejąca/nieaktywna
        // stylistka: anty-oracle (klientka nie dowiaduje się, czy została usunięta,
        // czy konto zniknęło) — parytet z bramką wyżej.
        // revoked_by = NULL to wiersze sprzed tej kolumny: traktowane jak zerwanie po
        // stronie klientki, żeby nie zablokować wstecznie istniejących relacji.
        if (
          existing.status === PairingStatusValue.REVOKED &&
          existing.revoked_by === AccountTypeValue.STYLIST
        ) {
          return failure({
            type: 'PAIR_REQUEST_STYLIST_NOT_FOUND',
            stylistAccountId: stylist_account_id,
          });
        }

        // REVOKED → PENDING: ponowna prośba po odcięciu. revoked_at CELOWO
        // zostaje (dowód, że para była kiedyś aktywna i odcięta — decline
        // przywraca REVOKED zamiast kasować wiersz, chroniąc crm_note).
        // paired_at = czas prośby (requested_at na liście próśb).
        //
        // CAS na statusie (Codex HIGH, lost-update): update wyłącznie po id
        // pozwalał T1 (prośba, odczytała REVOKED) nadpisać na PENDING wiersz,
        // który równoległy T2 (claim kodu 15-min) właśnie podniósł do ACTIVE —
        // claim zużyty, dostęp cofnięty. Predykat status=REVOKED w WHERE czyni
        // przejście atomowym; count=0 = przegrany wyścig → re-read i zwrot wg
        // faktycznego stanu (ACTIVE → ALREADY_PAIRED).
        // DECISION (nie usuwaj tego komentarza):
        // OKNO PONOWIENIA. Wycofanie własnej prośby (`cancelPairRequest_IO`)
        // ustawia `revoked_by=CLIENT`, a ta gałąź podnosi wiersz z powrotem do
        // PENDING — czyli klientka steruje OBOMA kierunkami przejścia i może je
        // cyklować. Każdy obrót raportował `created:true`, co odpala wpis audytu
        // ORAZ mail „prośba czeka". Zmierzone w runtime: 60 maili do jednej
        // stylistki w 3,6 s z jednego konta (dedup 60 s w email-transactional
        // kluczuje po `vars`, a `vars.clientName` to nazwa nadawcy — jedna zmiana
        // nazwy per obrót omija go w całości). Stylistka była BEZBRONNA: po
        // wycofaniu prośba znika z jej listy, więc nie ma czego odrzucić, a
        // `revoke-access` rusza wyłącznie pary ACTIVE. Jedyny hamulec to limiter
        // per-IP, który rotacja łącza resetuje.
        //
        // Traktujemy więc szybkie ponowienie jako TĘ SAMĄ prośbę wyrażoną
        // ponownie — dokładnie jak re-POST przy wiszącym PENDING wyżej:
        // stan wraca na PENDING (to jest prawda o wierszu i stylistka widzi go
        // w aplikacji od razu), ale `created:false` → zero maila, zero wpisu
        // audytu, zero pompowania lejka. `paired_at` NIE jest odświeżane, więc
        // okno liczy się od PIERWSZEJ prośby (spam nie przesuwa go w przód ani
        // nie podbija pozycji na liście — parytet z gałęzią PENDING).
        // Powiadomienie wraca po wygaśnięciu okna, bo wtedy ponowienie po
        // godzinie to realnie nowa próba kontaktu, a nie nękanie.
        //
        // Kotwicą jest `paired_at`, które oznacza także moment SPAROWANIA
        // (claim kodu, akceptacja), nie tylko poprzedniej prośby. Świadomie:
        // prośba wysłana tuż po rozłączeniu się z tą samą stylistką to ten sam
        // wzorzec „szarpania" i też nie zasługuje na osobne powiadomienie —
        // prośba i tak jest widoczna w aplikacji od razu. Okno nie przesuwa się
        // przy ponowieniach (nie odświeżamy `paired_at`), więc cisza nie jest
        // trwała: po godzinie od kotwicy najbliższa prośba znowu powiadamia.
        // `!= null` (nie `!== null`): brak wartości traktujemy jak brak
        // poprzedniej prośby, czyli powiadamiamy. Wcześniejsze `!== null`
        // przepuszczało `undefined` do `.getTime()` i zamieniało nieznany stan
        // wiersza w nieprzezroczysty błąd bazy zamiast w bezpieczną gałąź.
        const previousRequestAt = existing.paired_at;
        const isRapidReassert =
          previousRequestAt != null &&
          Date.now() - previousRequestAt.getTime() <
            PAIR_REQUEST_REASSERT_WINDOW_MS;

        const flipped = await tx.clientStylistPair.updateMany({
          where: { id: existing.id, status: PairingStatusValue.REVOKED },
          data: {
            status: PairingStatusValue.PENDING,
            ...(isRapidReassert ? {} : { paired_at: new Date() }),
          },
        });
        if (flipped.count === 0) {
          const current = await tx.clientStylistPair.findUnique({
            where: { id: existing.id },
            select: { status: true },
          });
          if (current?.status === PairingStatusValue.ACTIVE) {
            return success({
              status: 'ALREADY_PAIRED' as const,
              display_name: stylistAccount.display_name,
              created: false,
              pair_id: existing.id,
              notify: null,
            });
          }
          // PENDING (równoległa prośba wygrała) albo wiersz zniknął (decline
          // w locie — kolejny POST utworzy świeżą prośbę): idempotentny PENDING.
          return success({
            status: 'PENDING' as const,
            display_name: stylistAccount.display_name,
            created: false,
            pair_id: existing.id,
            notify: null,
          });
        }
        if (isRapidReassert) {
          return success({
            status: 'PENDING' as const,
            display_name: stylistAccount.display_name,
            created: false,
            pair_id: existing.id,
            notify: null,
          });
        }

        // DECISION (nie usuwaj tego komentarza) — D2 (2026-09-05), HIDE = MUTE:
        // stylistka, która UKRYŁA tę rozmowę, nie dostaje maila o ponownej
        // prośbie (znacznik stylist_hidden_at przeżywa przejście REVOKED→PENDING —
        // ponowna prośba NIE odkrywa wątku). `created` i odpowiedź dla klientki
        // pozostają identyczne (anty-oracle: klientka nie dowiaduje się o
        // wyciszeniu). Sama prośba jest realna: wraca na listę oczekujących po
        // „Przywróć" w skrzynce.
        return success({
          status: 'PENDING' as const,
          display_name: stylistAccount.display_name,
          created: true,
          pair_id: existing.id,
          notify:
            existing.stylist_hidden_at != null
              ? null
              : {
                  stylist_user_id: stylistAccount.created_by_user_id,
                  stylist_email: stylistAccount.created_by_user.email,
                  stylist_name: stylistAccount.created_by_user.name,
                },
        });
      }

      const createdPair = await tx.clientStylistPair.create({
        data: {
          client_user_id,
          stylist_account_id,
          status: PairingStatusValue.PENDING,
          paired_at: new Date(),
        },
        select: { id: true },
      });

      return success({
        status: 'PENDING' as const,
        display_name: stylistAccount.display_name,
        created: true,
        pair_id: createdPair.id,
        notify: {
          stylist_user_id: stylistAccount.created_by_user_id,
          stylist_email: stylistAccount.created_by_user.email,
          stylist_name: stylistAccount.created_by_user.name,
        },
      });
    });
  } catch (error) {
    // Wyścig dwóch PIERWSZYCH próśb tej samej pary (dwa urządzenia / HTTP
    // retry): przegrany create łapie unique-violation — to idempotentny
    // sukces, nie 500 (Codex #2; wzorzec session-container P2002).
    if (isP2002(error)) {
      return resolvePairRequestAfterUniqueRace({
        client_user_id,
        stylist_account_id,
      });
    }
    return databaseFailure('createPairRequest_IO', error);
  }
};

/**
 * O1: klientka wycofuje WŁASNĄ prośbę PENDING o połączenie. Atomowy updateMany
 * WHERE (client_user_id + stylist_account_id + status=PENDING) → REVOKED —
 * idempotentny (podwójny cancel / brak prośby → success:false, bez błędu).
 * Filtr WHERE gwarantuje, że klientka rusza TYLKO własną PENDING parę (zero
 * IDOR: obcy stylist_account_id albo cudza para nie matchują client_user_id).
 * Nie ruszamy par ACTIVE (to jest revokePairingAccess_IO) ani cudzych.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Cancel REVOKUJE wiersz, NIE kasuje — świadomie ROZBIEŻNIE z DECLINE
 * (respondPairRequest usuwa nigdy-nie-aktywną PENDING). Powód: komunikator (E,
 * StylistClientMessage onDelete:Cascade) pozwala klientce pisać do stylistki JUŻ
 * w stanie PENDING (dialog „Napisz do stylistki"). Delete pary kaskadowo zgubiłby
 * te wiadomości U OBU STRON; REVOKED zachowuje je jako read-only historię (parytet
 * z retencją revoke). Stąd bezwarunkowe REVOKED (nie delete-never-active/revoke-
 * once-active jak DECLINE). Stray revoked_at na nigdy-aktywnej parze = nieszkodliwy
 * (REVOKED mapuje na PUBLIC w access-status; re-request upsertuje z powrotem PENDING).
 */
export const cancelPairRequest_IO = async ({
  client_user_id,
  stylist_account_id,
}: {
  client_user_id: string;
  stylist_account_id: string;
}): Promise<OperationResult<{ success: boolean }, DatabaseError>> => {
  try {
    const { count } = await DB_CLIENT.use.clientStylistPair.updateMany({
      where: {
        client_user_id,
        stylist_account_id,
        status: PairingStatusValue.PENDING,
      },
      // Klientka cofa WLASNA prosbe — moze ja pozniej ponowic.
      data: {
        status: PairingStatusValue.REVOKED,
        revoked_at: new Date(),
        revoked_by: AccountTypeValue.CLIENT,
      },
    });
    return success({ success: count > 0 });
  } catch (error) {
    return databaseFailure('cancelPairRequest_IO', error);
  }
};

/**
 * Odpowiedź stylistki na prośbę PENDING. ACCEPT = przejście PENDING→ACTIVE
 * pod PEŁNYMI checkami obu capów (client platform-cap + stylist plan-cap) w
 * transakcji Serializable — dokładnie ten sam twardy guard co claim kodu
 * sesyjnego (count() = punkt serializacji SSI; współbieżne accepty nad capem
 * abortują z P2034 → 403). DECLINE = wiersz BEZWARUNKOWO wraca do REVOKED
 * (crm_note i wątek komunikatora przeżywają, parytet z cancelPairRequest_IO —
 * patrz DECISION w gałęzi DECLINE).
 */
export const respondPairRequest_IO = async ({
  stylist_account_id,
  stylist_pricing_plan,
  pair_id,
  action,
}: {
  stylist_account_id: string;
  stylist_pricing_plan: PricingPlan;
  pair_id: string;
  action: 'ACCEPT' | 'DECLINE';
}): Promise<
  OperationResult<
    { success: true; status: 'ACTIVE' | 'DECLINED' },
    | PairRequestNotFoundError
    | PairingLimitReachedError
    | PairingTooManyActiveSessionsError
    | DatabaseError
  >
> => {
  try {
    const planConfig = await getPlanConfig(stylist_pricing_plan);

    return await DB_CLIENT.use.$transaction(
      async tx => {
        // Ownership + stan w JEDNYM warunku (anty-oracle): cudza prośba,
        // nieistniejący wiersz i nie-PENDING status = ten sam NOT_FOUND.
        //
        // DECISION (nie usuwaj tego komentarza):
        // ASYMETRIA ACCEPT vs DECLINE na żywotności klientki. ACCEPT wymaga
        // client_user.is_active=true — bez tego stylistka podnosiła do ACTIVE parę z
        // klientką, którą API przed nią UKRYWA (soft-delete DOMAIN_SSOT §13.1 albo
        // admin-disable; getPendingPairRequests_IO i getMyPairs_IO filtrują is_active),
        // czyli tworzyła niewidzialną parę zjadającą slot obu capów (patrz
        // pairing-cap.predicates.ts). Martwa klientka zapada się w to samo
        // PAIR_REQUEST_NOT_FOUND, więc nie powstaje oracle „to konto zniknęło".
        // DECLINE celowo dopuszcza taki wiersz: klientka może zniknąć MIĘDZY
        // wyrenderowaniem listy próśb a tapnięciem „Odrzuć", a odmowa niczego nie
        // nadaje — tylko sprząta prośbę, więc 404 w tym wyścigu byłby wyłącznie
        // uciążliwy dla stylistki.
        const pair = await tx.clientStylistPair.findFirst({
          where: {
            id: pair_id,
            stylist_account_id,
            status: PairingStatusValue.PENDING,
            ...(action === 'ACCEPT'
              ? { client_user: { is_active: true } }
              : {}),
          },
          select: { id: true, client_user_id: true },
        });
        if (!pair) {
          return failure({ type: 'PAIR_REQUEST_NOT_FOUND', pairId: pair_id });
        }

        if (action === 'DECLINE') {
          // DECISION (nie usuwaj tego komentarza):
          // Odmowa REWOKUJE wiersz, NIGDY go nie kasuje — parytet z
          // cancelPairRequest_IO (klientka wycofująca własną prośbę, ten sam plik).
          // Wcześniejsza gałąź „revoked_at === null → delete" kasowała parę, a
          // StylistClientMessage wisi na niej z onDelete: Cascade i komunikator jest
          // otwarty JUŻ w stanie PENDING — więc jedno „Odrzuć" wymazywało całą
          // rozmowę U OBU STRON, bez śladu i bez zgody klientki. REVOKED zachowuje
          // wątek jako read-only historię (model retencji revoke) i crm_note.
          // revoked_by=STYLIST domyka pętlę: odrzucona klientka nie podniesie tego
          // wiersza z powrotem do PENDING (patrz DECISION w createPairRequest_IO),
          // powrót prowadzi wyłącznie przez zeskanowanie kodu stylistki.
          await tx.clientStylistPair.update({
            where: { id: pair.id },
            data: {
              status: PairingStatusValue.REVOKED,
              revoked_at: new Date(),
              revoked_by: AccountTypeValue.STYLIST,
            },
          });
          return success({
            success: true as const,
            status: 'DECLINED' as const,
          });
        }

        // ACCEPT — oba capy jak w claim (PENDING nie liczył się do limitów,
        // więc dopiero TU para zaczyna kosztować slot po obu stronach).
        const clientPairingsCount = await tx.clientStylistPair.count({
          where: {
            client_user_id: pair.client_user_id,
            ...ACTIVE_PAIR_FOR_CAP,
          },
        });
        if (!PRICING_POLICY.utils.canPairStylist(clientPairingsCount)) {
          return failure({
            type: 'PAIRING_LIMIT_REACHED',
            currentCount: clientPairingsCount,
            limit: PRICING_POLICY.PLATFORM_LIMITS.MAX_PAIRED_STYLISTS,
            planType: 'PLATFORM',
          });
        }

        const stylistPairsCount = await tx.clientStylistPair.count({
          where: {
            stylist_account_id,
            ...ACTIVE_PAIR_FOR_CAP,
          },
        });
        if (
          !PRICING_POLICY.utils.canPairClient(planConfig, stylistPairsCount)
        ) {
          return failure({
            type: 'PAIRING_LIMIT_REACHED',
            currentCount: stylistPairsCount,
            limit: planConfig.max_paired_clients,
            planType: narrowPricingPlan(stylist_pricing_plan),
          });
        }

        // Atomic guard (wzorzec claim krok 3): WHERE powtarza wszystkie
        // race-loser predykaty — przegrany współbieżny accept/decline/claim
        // trafia count=0 → NOT_FOUND zamiast podwójnej aktywacji.
        const updated = await tx.clientStylistPair.updateMany({
          where: {
            id: pair.id,
            stylist_account_id,
            status: PairingStatusValue.PENDING,
            // Race-loser także wtedy, gdy klientka zniknęła po odczycie wyżej —
            // ACCEPT nigdy nie aktywuje pary z niewidoczną drugą stroną.
            client_user: { is_active: true },
          },
          data: {
            status: PairingStatusValue.ACTIVE,
            paired_at: new Date(),
            revoked_at: null,
            // Symetrycznie do `revoked_at` i do upsertu przy claimie: para znowu
            // żyje, więc ślad po poprzednim zerwaniu przestaje obowiązywać.
            // Zostawienie go dawało wiersz ACTIVE z nieaktualnym „zerwała stylistka".
            revoked_by: null,
          },
        });
        if (updated.count === 0) {
          return failure({ type: 'PAIR_REQUEST_NOT_FOUND', pairId: pair.id });
        }

        // Post-upsert backstop (parytet z claim 4.1): rollback gdy równoległe
        // accepty tej samej KLIENTKI przekroczyły platform-cap mimo pre-checku.
        const postCount = await tx.clientStylistPair.count({
          where: {
            client_user_id: pair.client_user_id,
            ...ACTIVE_PAIR_FOR_CAP,
          },
        });
        if (!PRICING_POLICY.utils.canPairStylist(postCount - 1)) {
          throw new PairingLimitExceededRollback(postCount);
        }

        return success({ success: true as const, status: 'ACTIVE' as const });
      },
      { isolationLevel: 'Serializable' }
    );
  } catch (error) {
    if (error instanceof PairingLimitExceededRollback) {
      return failure({
        type: 'PAIRING_LIMIT_REACHED',
        currentCount: error.currentCount,
        limit: PRICING_POLICY.PLATFORM_LIMITS.MAX_PAIRED_STYLISTS,
        planType: 'PLATFORM',
      });
    }
    if (isSerializationConflict(error)) {
      // 40001 = przegrana tx SSI (rw-conflict), NIE dowód breachu capa —
      // retry przejdzie albo trafi w deterministyczny pre-check. Mapowanie na
      // PAIRING_LIMIT_REACHED dawało fałszywe, trwałe 403 „limit -1/-1"
      // (Codex #3). Parytet z claim: retryable 429 TOO_MANY.
      return failure({
        type: 'PAIRING_TOO_MANY_ACTIVE_SESSIONS',
        currentCount: -1,
        limit: -1,
      });
    }
    return databaseFailure('respondPairRequest_IO', error);
  }
};
