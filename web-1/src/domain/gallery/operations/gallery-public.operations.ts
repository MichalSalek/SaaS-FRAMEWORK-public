import { DB_CLIENT } from '@app/db/db.client';
import type { Prisma } from '../../../prisma/js-client';
import { STYLIST_PUBLICLY_VISIBLE } from '@domain/account/account.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  PRICING_POLICY,
  narrowPricingPlan,
} from '@kernel/policies/pricing.policy';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import {
  assertType,
  isNailLengthNarrower,
} from '@kernel/models/type_narrowing';
import {
  GALLERY_COLORS_TRAITS_SELECT,
  mapGalleryColors,
  mapGalleryTraits,
} from '@domain/gallery/gallery.utils.api';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { GalleryRecordNotFoundError } from '@kernel/domain/gallery/gallery-errors.types';
import type {
  AccountNotFoundError,
  DatabaseError,
} from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { VISIBLE_PINNED_GALLERY_RECORD_WHERE } from '@domain/gallery/gallery-record-visibility';
import { resolvePublicGalleryCeiling } from '@domain/gallery/public-gallery-count';

// DECISION (nie usuwaj tego komentarza) — 2026-09-10:
// NIE MA drugiej liczby obok sufitu planu. Wcześniej żyła tu stała
// DEFAULT_PUBLIC_GALLERY_TAKE = 24 jako „domyślna porcja bez `limit`" i to ONA,
// a nie plan, ścinała STUDIO (30) i SCALE (50) do 24 — czyli dokładnie ten sam
// błąd, który naprawialiśmy po stronie handlera (twarde 5). Każda liczba obok
// PRICING_LIMITS_SSOT.max_pinned_records jest drugą władzą nad tą samą sprzedaną
// drabinką 3→10→15→30→50 i prędzej czy później się z nią rozjedzie. Więc:
// domyślnym rozmiarem strony JEST sufit planu. Jest to bezpieczne, bo zbiór
// przypiętych prac jest z definicji ograniczony bramką zapisu (canPinGalleryRecord),
// więc „cała strona" to najwyżej 50 rekordów — tyle samo, ile publiczny explore
// oddaje jedną stroną (VALIDATION_PAGINATION.LIMIT_MAX_BROWSE).
//
// Sufit planu (w tym obsługa `max_pinned_records: -1`) mieszka w
// `public-gallery-count.ts` — ten sam, którym liczą się publiczne liczniki prac,
// żeby profil nie obiecywał więcej, niż ta galeria odda.

/**
 * Okno rekordów, jakie publiczny profil w ogóle może oddać: sufit planu ogranicza
 * NIE TYLKO rozmiar strony (`take`), ale i jej przesunięcie (`skip`). Bez tego
 * drugiego sufit nie był sufitem — paginacja po `offset` przechodziła obok niego
 * (zmierzone: FREE, limit 3, offset 0/3/6/9 → 12 z 12 rekordów w 4 żądaniach).
 */
const resolvePublicGalleryWindow = ({
  ceiling,
  limit,
  offset,
}: {
  ceiling: number;
  limit: number | undefined;
  offset: number | undefined;
}): { take: number; skip: number } => {
  // Math.trunc + dolne zero: kontrakt (zod w jądrze) już odrzuca ułamki i wartości
  // spoza zakresu, ale operacja jest eksportowana i musi sama gwarantować, że do
  // Prismy nie trafi float ani liczba ujemna (skip/take → błąd Postgresa → 503).
  const skip = Math.min(Math.max(Math.trunc(offset ?? 0), 0), ceiling);
  const requested = Math.max(Math.trunc(limit ?? ceiling), 0);
  return { take: Math.min(requested, ceiling - skip), skip };
};

/** Strona rekordów galerii publicznej — wydzielona, by pusty wynik miał ten sam typ. */
const fetchPublicGalleryPage = ({
  where,
  take,
  skip,
}: {
  where: Prisma.GalleryRecordWhereInput;
  take: number;
  skip: number;
}) =>
  DB_CLIENT.use.galleryRecord.findMany({
    where,
    include: { ...GALLERY_COLORS_TRAITS_SELECT },
    // Tiebreaker on gallery_record_id (cuid) — created_at is non-unique, so a
    // single-field sort lets records swap/duplicate across page boundaries.
    orderBy: [{ created_at: 'desc' }, { gallery_record_id: 'desc' }],
    take,
    skip,
  });

type PublicGalleryRow = Awaited<
  ReturnType<typeof fetchPublicGalleryPage>
>[number];

/**
 * Get public gallery records for a stylist account
 * Only returns pinned records for active accounts
 */
export const publicGetGalleryRecordsByAccount_IO = async ({
  props,
}: {
  props: GALLERY_DTO_API_V1['PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT']['REQUEST'];
}): Promise<
  OperationResult<
    GALLERY_DTO_API_V1['PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT']['RESPONSE'],
    AccountNotFoundError | GalleryRecordNotFoundError | DatabaseError
  >
> => {
  try {
    const { account_id, color_ids, trait_ids, limit, offset } = props;

    // Get account info — full STYLIST_PUBLICLY_VISIBLE gate (account_status ACTIVE +
    // created_by_user.is_active). findFirst (not findUnique): findUnique.where only accepts
    // unique fields; created_by_user.is_active is non-unique, so we combine the unique
    // account_id with the relation filter via findFirst (same pattern as og-meta / account-profile
    // siblings). Not-visible → same ACCOUNT_NOT_FOUND as not-found (anti-enumeration parity).
    const account = await DB_CLIENT.use.stylistAccount.findFirst({
      where: {
        account_id: account_id,
        ...STYLIST_PUBLICLY_VISIBLE,
      },
      select: {
        account_id: true,
        display_name: true,
        business_name: true,
        address_city: true,
        pricing_plan: true,
        brand_accent_color: true,
      },
    });

    if (!account) {
      return failure({
        type: 'ACCOUNT_NOT_FOUND',
        accountId: account_id,
      });
    }

    // Build filter conditions
    const where: Prisma.GalleryRecordWhereInput = {
      created_by_account_id: account_id,
      // Only pinned records, minus those hidden by moderation.
      ...VISIBLE_PINNED_GALLERY_RECORD_WHERE,
    };

    // DECISION (nie usuwaj tego komentarza):
    // color_ids/trait_ids tu = AND (każde id → osobny `some`), inaczej niż siostrzane
    // explore/list (apply_strict_filter, default OR). Rozjazd jest NIEODCZUWALNY: ta
    // ścieżka filtrów jest DORMANT — jedyny konsument (main useStylistGallery) woła
    // publiczny endpoint tylko z { account_id } i filtruje client-side w
    // useGalleryFiltersState nad przypiętymi rekordami do SUFITU Z PLANU (tam default = OR przez
    // exactMatch:false, z opcjonalnym AND). Nie przepisujemy na OR spekulacyjnie
    // (zmiana zachowania toru bez wywołującego = churn+ryzyko; goły string[] i tak nie
    // odda „OR-default + AND-opt-in"). GDYBY pojawił się realny server-side caller z
    // multi-selectem — odwzoruj wtedy explore/list: OR-by-default + opcjonalny strict/AND.
    // Add color filters if provided
    if (color_ids && color_ids.length > 0) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        ...color_ids.map(cid => ({
          colors: { some: { color_id: cid } },
        })),
      ];
    }

    // Add trait filters if provided
    if (trait_ids && trait_ids.length > 0) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        ...trait_ids.map(tid => ({
          traits: { some: { trait_id: tid } },
        })),
      ];
    }

    // DECISION (nie usuwaj tego komentarza) — 2026-09-09, doprecyzowane 2026-09-10:
    // Sufit publicznej galerii = LIMIT PINÓW Z PLANU, nie stała. Twarde
    // `Math.min(limit || 5, 5)` unieważniało sprzedawaną drabinkę 3→10→15→30→50:
    // stylistka na Studio przypinała 30 prac, a profil publiczny i tak pokazywał
    // pięć. Zapis i tak nie przepuści więcej pinów niż plan (canPinGalleryRecord),
    // więc ten sufit jest sufitem STRONY, nie drugą bramką biznesową — ale MUSI
    // obejmować całe okno (take ORAZ skip), inaczej klient obchodzi go paginacją.
    const ceiling = resolvePublicGalleryCeiling(account.pricing_plan);
    const { take, skip } = resolvePublicGalleryWindow({
      ceiling,
      limit,
      offset,
    });

    // Get total count + paginated records in parallel
    const [totalCount, records] = await Promise.all([
      DB_CLIENT.use.galleryRecord.count({
        where,
      }),
      // Okno wyczerpane (offset dobił do sufitu planu) → pusta strona BEZ zapytania.
      take > 0
        ? fetchPublicGalleryPage({ where, take, skip })
        : Promise.resolve<PublicGalleryRow[]>([]),
    ]);

    const showWatermark = account.pricing_plan === PricingPlanValue.FREE;

    return success({
      records: records.map(record => ({
        gallery_record_id: record.gallery_record_id,
        asset_url: record.asset_url,
        colors: mapGalleryColors(record.colors),
        traits: mapGalleryTraits(record.traits),
        nail_length: assertType(
          record.nail_length,
          isNailLengthNarrower,
          'nail_length in publicGetGalleryRecordsByAccount_IO'
        ),
        created_at: record.created_at,
      })),
      // DECISION (nie usuwaj tego komentarza) — 2026-09-10:
      // `total_count` = ile ten endpoint REALNIE odda, więc jest ścięty tym samym
      // sufitem planu co `take`/`skip`. Wcześniej był to goły `count(where)`, czyli
      // liczba, której endpoint z definicji nie potrafił dowieźć (FREE: records=3,
      // total_count=12) — profil obiecywał prace, których nie pokaże, i podawał
      // klientowi dokładną liczbę stron do przejścia (patrz okno wyżej).
      // W stanie legalnym ta zmiana jest NO-OPEM: bramka zapisu nie wpuszcza więcej
      // pinów niż plan, a `where` liczy tylko przypięte i widoczne, więc
      // count ≤ sufit. Różnicę widać wyłącznie po downgrade planu (piny zostają,
      // sufit spada) — i wtedy właśnie prawdą jest sufit, nie zaległy count.
      total_count: Math.min(totalCount, ceiling),
      show_watermark: showWatermark,
      stylist_info: {
        account_id: account.account_id,
        display_name: account.display_name,
        business_name: account.business_name,
        address_city: account.address_city,
        // Branding-light krok 2: maska planu przy ODCZYCIE (write-gate nie
        // czyści kolumny przy downgrade — parytet z public profile, S51).
        brand_accent_color: PRICING_POLICY.LIMITS[
          narrowPricingPlan(account.pricing_plan)
        ].can_brand_profile
          ? account.brand_accent_color
          : null,
      },
    });
  } catch (error) {
    return databaseFailure('publicGetGalleryRecordsByAccount_IO', error);
  }
};
