import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  isUnlimitedLimit,
  PRICING_POLICY,
} from '@kernel/policies/pricing.policy';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { lockStylistAccount } from '@app/db/lock-rows';
import { VISIBLE_PINNED_GALLERY_RECORD_WHERE } from '@domain/gallery/gallery-record-visibility';
import type {
  GalleryRecordNotFoundError,
  GalleryPinLimitReachedError,
  GalleryRecordAlreadyPinnedError,
  GalleryRecordNotPinnedError,
} from '@kernel/domain/gallery/gallery-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';

/**
 * Pin a gallery record (atomic transaction).
 *
 * Race-condition fix (Finding #9): the previous implementation used
 * findUnique → check → update which allows multiple concurrent requests
 * to all read is_pinned=false and all succeed (3×SUCCESS instead of
 * 1×SUCCESS + 2×ALREADY_PINNED).
 *
 * Fix: atomic updateMany with { id, is_pinned: false, owner } in WHERE.
 * PostgreSQL executes this as a single atomic statement — only one
 * concurrent request can match and flip is_pinned=true. All others get
 * count=0 and fall through to the fetch-to-distinguish path.
 *
 * Cross-record pin-quota race fix (finding gallery-1): see the DECISION on the
 * StylistAccount FOR UPDATE lock inside the transaction below.
 */
export const pinGalleryRecord_IO = async ({
  gallery_record_id,
  stylist_account_id,
  pricing_plan,
}: {
  gallery_record_id: string;
  stylist_account_id: string;
  pricing_plan: PricingPlan;
}): Promise<
  OperationResult<
    { pinnedCount: number },
    // DECISION (nie usuwaj tego komentarza): brak GalleryRecordOwnershipError —
    // cudzy rekord maskowany jako GALLERY_RECORD_NOT_FOUND (anti-enumeration, patrz
    // DECISION przy gałęzi ownership niżej). Op nigdy nie zwraca OWNERSHIP_ERROR.
    | GalleryRecordNotFoundError
    | GalleryRecordAlreadyPinnedError
    | GalleryPinLimitReachedError
    | DatabaseError
  >
> => {
  const planConfig = PRICING_POLICY.utils.getPlanConfig(pricing_plan);
  const pinLimit = planConfig.max_pinned_records;

  try {
    return await DB_CLIENT.use.$transaction(async tx => {
      // DECISION (nie usuwaj tego komentarza) — cross-record pin-quota race (finding gallery-1):
      // PESYMISTYCZNY row-lock (SELECT ... FOR UPDATE) na WSPÓLNYM wierszu StylistAccount,
      // brany JAKO PIERWSZY w tej tx — ZANIM policzymy pinned i ZANIM zrobimy updateMany.
      // To jest punkt serializacji całej operacji pinowania per-konto. Powód: pod READ
      // COMMITTED (domyślny poziom $transaction) współbieżne piny na RÓŻNYCH rekordach tego
      // samego konta NIE kolidowały o żaden wspólny wiersz (atomic updateMany serializuje
      // tylko piny na TYM SAMYM rekordzie), więc każda tx czytała count<limit, każda flipowała
      // swój wiersz, a POST-VERIFY recount widział wciąż przed-commitowy snapshot peera →
      // limit+N commitował (na FREE: limit 3, burst 5-8 → 4-6 pinów). Lock serializuje wszystkich
      // piszących to konto w JEDNEJ kolejności: przegrany CZEKA na locku, a po commicie zwycięzcy
      // czyta JUŻ skommitowany count i pre-check go odrzuca → czyste GALLERY_PIN_LIMIT_REACHED
      // (403, poprawna semantyka: limit faktycznie osiągnięty), bez Serializable/40001-retry.
      // To DOKŁADNIE ten sam mechanizm, który już chroni gallery-create: incrementGalleryCount
      // robi UPDATE "StylistAccount" WHERE account_id=X — pisze ten sam wiersz, więc create
      // serializuje się implicite. Pin był jedynym per-konto quota-writerem BEZ dotknięcia tego
      // wiersza, stąd dziura. Wzorzec lock-first: moderation-admin.operations.ts (lockStylistAccountRow).
      // KROK 3b: inline $queryRaw FOR UPDATE skonsolidowany do kanonicznego lockStylistAccount
      // (@app/db/lock-rows — NEUTRALNY primityw application/db, NIE moderation, wiec wczesniejsza
      // obawa o kierunek zaleznosci moderation→gallery nie dotyczy; lock-rows.ts wprost wskazuje
      // gallery-pin jako konsumenta). Byte-identyczna semantyka (SELECT account_id ... FOR UPDATE),
      // wynik swiadomie odrzucany (lock side-effect; wiersz zawsze istnieje — account_id z sesji).
      await lockStylistAccount(tx, stylist_account_id);

      // DECISION (nie usuwaj tego komentarza) — already-pinned PRZED quota-gate (finding testy-api pin-1):
      // re-pin JUZ przypietego rekordu to idempotentny no-op — rekord jest juz wliczony w limit,
      // wiec NIE konsumuje nowego slotu. Rozstrzygamy stan TEGO rekordu ZANIM zbadamy quote: bez tego
      // re-pin przy osiagnietym limicie zwracal GALLERY_PIN_LIMIT_REACHED (403) zamiast
      // GALLERY_RECORD_ALREADY_PINNED (400) — mylne (to nie problem limitu, slot jest zajety przez TEN
      // rekord). Not-found / cudzy rekord tez rozstrzygamy tutaj (parytet anti-enumeration mask nizej).
      // Pod FOR UPDATE lock (wyzej) odczyt jest spojny z rownoleglymi pinami tego konta. Gdy rekord
      // odpiety -> przechodzimy do quota + atomic updateMany (race-loser w ogonie: count===0 przy
      // owner-ok = concurrent-pin-won = ALREADY_PINNED).
      const target = await tx.galleryRecord.findUnique({
        where: { gallery_record_id },
        select: {
          created_by_account_id: true,
          is_pinned: true,
          is_hidden: true,
        },
      });

      if (!target) {
        return failure({
          type: 'GALLERY_RECORD_NOT_FOUND',
          recordId: gallery_record_id,
        });
      }

      if (target.created_by_account_id !== stylist_account_id) {
        reportIssueBackend({
          namespace: 'pinGalleryRecord_IO',
          message: `Unauthorized pin attempt (masked as 404). Owner: ${target.created_by_account_id}, Requester: ${stylist_account_id}`,
          payload: { gallery_record_id },
          mode: 'error',
        });
        return failure({
          type: 'GALLERY_RECORD_NOT_FOUND',
          recordId: gallery_record_id,
        });
      }

      // DECISION (nie usuwaj tego komentarza) — 2026-09-10, rekord UKRYTY MODERACYJNIE
      // NIE DA SIĘ PRZYPIĄĆ (finding gallery-5):
      // pin dotyczy WYŁĄCZNIE wizytówki publicznej, a publiczna galeria filtruje
      // `is_hidden:false` — więc przypięcie ukrytego rekordu kończyło się 200 SUCCESS,
      // zjadało slot z planu i nie pokazywało NICZEGO (zmierzone: pinned_count=2,
      // publiczna galeria oddaje 1 rekord). Stylistka po cichu traciła slot.
      // Maska = to samo GALLERY_RECORD_NOT_FOUND co rekord cudzy/nieistniejący, bo
      // dla POWIERZCHNI PUBLICZNEJ ten rekord faktycznie nie istnieje (parytet z
      // gallery-detail.query, gdzie ukryty rekord jest 404 dla każdego poza
      // właścicielem). Dedykowany błąd domenowy („praca ukryta przez moderację")
      // byłby czytelniejszy dla właścicielki, ale wymaga typu w jądrze + gałęzi w
      // error-mapperze — patrz raport sesji (needs-kernel).
      // Ukrycie jest w tym systemie TERMINALNE: żadna ścieżka nie zapisuje
      // `is_hidden:false` (un-ban świadomie NIE odkrywa hurtem — moderation-admin),
      // więc nie ma stanu „odkryte z powrotem", w którym ta odmowa byłaby przedwczesna.
      if (target.is_hidden) {
        return failure({
          type: 'GALLERY_RECORD_NOT_FOUND',
          recordId: gallery_record_id,
        });
      }

      if (target.is_pinned) {
        return failure({
          type: 'GALLERY_RECORD_ALREADY_PINNED',
          recordId: gallery_record_id,
        });
      }

      // Quota check before the atomic update. With the FOR UPDATE lock above held,
      // this count reads COMMITTED state (concurrent pins for this account queue on
      // the lock), so it is now the authoritative gate — not just a fast-fail.
      //
      // DECISION (nie usuwaj tego komentarza) — 2026-09-10: kwota liczy piny WIDOCZNE
      // (`is_hidden:false`), bo dokładnie tyle prac oddaje wizytówka publiczna i tyle
      // pokazuje kafel zużycia w panelu (account-dashboard liczy `is_pinned + !is_hidden`).
      // Wcześniej ta jedna liczba szła innym filtrem niż obie powierzchnie, które ją
      // pokazują: rekord ukryty PO przypięciu trzymał slot, panel mówił „2/3", a bramka
      // odmawiała jak przy 3/3. Parytet z resztą liczników per-konto, które w tym
      // projekcie liczą wyłącznie rekordy widoczne (cached_gallery_count,
      // cached_likes_count — patrz favorite-count.helper / gallery-delete).
      const pinnedCount = await tx.galleryRecord.count({
        where: {
          created_by_account_id: stylist_account_id,
          ...VISIBLE_PINNED_GALLERY_RECORD_WHERE,
        },
      });

      if (!PRICING_POLICY.utils.canPinGalleryRecord(planConfig, pinnedCount)) {
        return failure({
          type: 'GALLERY_PIN_LIMIT_REACHED',
          currentPinned: pinnedCount,
          limit: pinLimit,
        });
      }

      // Atomic guard: WHERE includes is_pinned=false + ownership so only
      // one concurrent request wins. PostgreSQL's UPDATE is atomic — no
      // two transactions can both match and increment the same row.
      const updated = await tx.galleryRecord.updateMany({
        where: {
          gallery_record_id,
          is_pinned: false,
          created_by_account_id: stylist_account_id,
          // Cały warunek wstępny w jednym atomowym UPDATE — moderacyjne HIDE bierze
          // wprawdzie ten sam lock na StylistAccount (patrz moderation-admin), więc
          // is_hidden nie może się przestawić w tej tx, ale bramka niech będzie
          // samowystarczalna: to samo zdanie SQL sprawdza to, co pre-check wyżej.
          is_hidden: false,
        },
        data: { is_pinned: true },
      });

      if (updated.count > 0) {
        // DECISION (nie usuwaj tego komentarza):
        // POST-UPDATE VERIFY recount = belt-and-suspenders defence-in-depth (DD2-A3).
        // Po dodaniu FOR UPDATE locka na StylistAccount (patrz DECISION na początku tej tx,
        // finding gallery-1) cross-record pin-race jest domknięty u ŹRÓDŁA: piny per-konto
        // serializują się na locku, więc pre-check (count pod lockiem) czyta committed state
        // i jest autorytatywną bramką. Ten recount praktycznie NIGDY już nie odpala (po locku
        // pre-check by wcześniej odrzucił przegranego). ZOSTAWIONY celowo jako tani in-tx guard
        // (gdyby pojawił się inny, nielockujący writer is_pinned) — finalPinnedCount>limit
        // rzuca sentinel → rollback → zewnętrzny catch mapuje na GALLERY_PIN_LIMIT_REACHED.
        // NIE jest to już — wbrew poprzedniej wersji tego komentarza — PIERWOTNY fix wyścigu:
        // sam recount pod READ COMMITTED czytał przed-commitowy snapshot peera i wyścigu NIE
        // domykał (potwierdzone live: burst 5-8 → 4-6 pinów). Lock domyka, recount asekuruje.
        // Pattern parity: gallery-create.operation.ts (recount) + moderation-admin (lock-first).
        if (!isUnlimitedLimit(pinLimit)) {
          const finalPinnedCount = await tx.galleryRecord.count({
            where: {
              created_by_account_id: stylist_account_id,
              // Ten sam filtr widoczności co pre-check wyżej — inaczej recount
              // porównywałby z limitem inny zbiór niż bramka, która go przepuściła.
              ...VISIBLE_PINNED_GALLERY_RECORD_WHERE,
            },
          });
          if (finalPinnedCount > pinLimit) {
            throw new Error('__PIN_QUOTA_RACE__');
          }
        }
        // Happy path: we won the race.
        return success({ pinnedCount: pinnedCount + 1 });
      }

      // count===0: not found, not owner, or already pinned — fetch once to
      // distinguish. This path is hit only in the failure/race-loser case.
      const existing = await tx.galleryRecord.findUnique({
        where: { gallery_record_id },
        select: {
          created_by_account_id: true,
          is_pinned: true,
          is_hidden: true,
        },
      });

      if (!existing || existing.is_hidden) {
        // Zniknął albo został ukryty między pre-checkiem a UPDATE — obie ścieżki
        // dają tę samą maskę 404 co gałąź is_hidden wyżej (rekord nie istnieje dla
        // powierzchni publicznej).
        return failure({
          type: 'GALLERY_RECORD_NOT_FOUND',
          recordId: gallery_record_id,
        });
      }

      // DECISION (nie usuwaj tego komentarza):
      // ANTI-ENUMERATION MASK (IDOR existence-oracle) — cudzy (istniejący-nie-twój) rekord
      // zwraca DOKŁADNIE ten sam GALLERY_RECORD_NOT_FOUND (404) co rekord nieistniejący,
      // zamiast OWNERSHIP_ERROR (403). 403-vs-404 zdradzał istnienie cudzego rekordu (oracle).
      // Po masce obie ścieżki są nieodróżnialne dla klienta. Próbę logujemy server-side
      // (mode:'error', z ownerId) dla forensyki — kanał wewnętrzny, nie wycieka do odpowiedzi.
      // Parytet z gallery-update / gallery-delete. Ownership-check nadal PO RBAC (sesja).
      if (existing.created_by_account_id !== stylist_account_id) {
        reportIssueBackend({
          namespace: 'pinGalleryRecord_IO',
          message: `Unauthorized pin attempt (masked as 404). Owner: ${existing.created_by_account_id}, Requester: ${stylist_account_id}`,
          payload: { gallery_record_id },
          mode: 'error',
        });
        return failure({
          type: 'GALLERY_RECORD_NOT_FOUND',
          recordId: gallery_record_id,
        });
      }

      // Record exists, is owned by requester, but is_pinned=true — either
      // it was already pinned before this request, or a concurrent request
      // won the race. Both cases: correct response is ALREADY_PINNED.
      return failure({
        type: 'GALLERY_RECORD_ALREADY_PINNED',
        recordId: gallery_record_id,
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === '__PIN_QUOTA_RACE__') {
      return failure({
        type: 'GALLERY_PIN_LIMIT_REACHED',
        currentPinned: pinLimit,
        limit: pinLimit,
      });
    }
    return databaseFailure('pinGalleryRecord', error);
  }
};

/**
 * Unpin a gallery record (atomic transaction).
 *
 * DECISION (nie usuwaj tego komentarza) — 2026-09-10, unpin dostaje TEN SAM wzorzec
 * co pin: lock-first + atomowy updateMany (finding gallery-6).
 * Wcześniej unpin był gołym read-then-update BEZ locka, więc jedna zmiana stanu
 * potrafiła zwrócić DWA razy 200 SUCCESS (zmierzone: burst 4 unpinów → 2×200
 * + 2×400 NOT_PINNED, przy jednym realnym przejściu pinned→unpinned). Limit planu
 * nie był naruszony — kłamała ODPOWIEDŹ: przegrany wyścig raportował sukces operacji,
 * której nie wykonał, i doklejał `pinnedCount` policzony po cudzym commicie.
 * Lock na StylistAccount serializuje unpin z pinem TEGO SAMEGO konta (pin bierze ten
 * sam wiersz), więc `pinnedCount` w odpowiedzi jest liczbą po TEJ operacji, a nie
 * migawką złapaną w połowie cudzej transakcji.
 */
export const unpinGalleryRecord_IO = async ({
  gallery_record_id,
  stylist_account_id,
}: {
  gallery_record_id: string;
  stylist_account_id: string;
}): Promise<
  OperationResult<
    { pinnedCount: number },
    // DECISION (nie usuwaj tego komentarza): brak GalleryRecordOwnershipError —
    // cudzy rekord maskowany jako GALLERY_RECORD_NOT_FOUND (anti-enumeration, patrz
    // DECISION przy gałęzi ownership niżej). Op nigdy nie zwraca OWNERSHIP_ERROR.
    GalleryRecordNotFoundError | GalleryRecordNotPinnedError | DatabaseError
  >
> => {
  try {
    return await DB_CLIENT.use.$transaction(async tx => {
      // Punkt serializacji per-konto, brany JAKO PIERWSZY — ten sam wiersz i ta sama
      // kolejność co w pinGalleryRecord_IO (patrz DECISION tam), więc pin i unpin tego
      // samego konta nigdy nie liczą pinów na wzajemnie przed-commitowej migawce.
      await lockStylistAccount(tx, stylist_account_id);

      const record = await tx.galleryRecord.findUnique({
        where: { gallery_record_id },
        select: { created_by_account_id: true, is_pinned: true },
      });

      if (!record) {
        return failure({
          type: 'GALLERY_RECORD_NOT_FOUND',
          recordId: gallery_record_id,
        });
      }

      // DECISION (nie usuwaj tego komentarza):
      // ANTI-ENUMERATION MASK (IDOR existence-oracle) — cudzy (istniejący-nie-twój) rekord
      // zwraca ten sam GALLERY_RECORD_NOT_FOUND (404) co rekord nieistniejący, zamiast
      // OWNERSHIP_ERROR (403). 403-vs-404 zdradzał istnienie cudzego rekordu. Po masce obie
      // ścieżki nieodróżnialne dla klienta; próbę logujemy server-side (forensyka, kanał
      // wewnętrzny). Parytet z pinGalleryRecord_IO / gallery-update / gallery-delete.
      if (record.created_by_account_id !== stylist_account_id) {
        reportIssueBackend({
          namespace: 'unpinGalleryRecord_IO',
          message: `Unauthorized unpin attempt (masked as 404). Owner: ${record.created_by_account_id}, Requester: ${stylist_account_id}`,
          payload: { gallery_record_id },
          mode: 'error',
        });
        return failure({
          type: 'GALLERY_RECORD_NOT_FOUND',
          recordId: gallery_record_id,
        });
      }

      if (!record.is_pinned) {
        return failure({
          type: 'GALLERY_RECORD_NOT_PINNED',
          recordId: gallery_record_id,
        });
      }

      // Atomowa bramka (parytet z pinem): pełny warunek wstępny w JEDNYM zdaniu SQL,
      // więc tylko jedno żądanie może wykonać przejście pinned→unpinned.
      // updateMany zamiast update NIE rzuca P2025, gdy rekord zniknął w locie —
      // wraca count=0 i rozstrzygamy to niżej jednym odczytem (ta sama maska 404,
      // której wcześniej pilnowała gałąź isP2025 w catchu).
      const updated = await tx.galleryRecord.updateMany({
        where: {
          gallery_record_id,
          is_pinned: true,
          created_by_account_id: stylist_account_id,
        },
        data: { is_pinned: false },
      });

      if (updated.count === 0) {
        const existing = await tx.galleryRecord.findUnique({
          where: { gallery_record_id },
          select: { created_by_account_id: true, is_pinned: true },
        });
        if (
          !existing ||
          existing.created_by_account_id !== stylist_account_id
        ) {
          // Zniknął (owner delete / moderation DELETE) albo — teoretycznie —
          // przestał być nasz: ta sama maska anty-enumeracyjna co wyżej.
          return failure({
            type: 'GALLERY_RECORD_NOT_FOUND',
            recordId: gallery_record_id,
          });
        }
        // Przegraliśmy wyścig z równoległym unpinem: rekord jest już odpięty, ale
        // TO żądanie niczego nie zmieniło — 400 NOT_PINNED, nie 200 SUCCESS.
        return failure({
          type: 'GALLERY_RECORD_NOT_PINNED',
          recordId: gallery_record_id,
        });
      }

      const pinnedCount = await tx.galleryRecord.count({
        where: {
          created_by_account_id: stylist_account_id,
          // Ten sam filtr widoczności co bramka pinu — jedna definicja „ile masz
          // przypiętych" na obu ścieżkach i w kaflach zużycia (account-dashboard,
          // usage-stats).
          ...VISIBLE_PINNED_GALLERY_RECORD_WHERE,
        },
      });

      return success({ pinnedCount });
    });
  } catch (error) {
    return databaseFailure('unpinGalleryRecord', error);
  }
};
