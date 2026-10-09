import { DB_CLIENT } from '@app/db/db.client';
import { PairingStatusValue } from '@kernel/models/db_models.generated.dto';
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
import { STYLIST_PUBLICLY_VISIBLE } from '@domain/account/account.config';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { GalleryRecordNotFoundError } from '@kernel/domain/gallery/gallery-errors.types';
import type { PairingSessionNotFoundError } from '@kernel/domain/pairing/pairing-errors.types';
import type {
  DatabaseError,
  StylistNotFoundError,
} from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';

// Helper extracted so we can reuse the inferred return type in the parent
// without manually re-declaring the Prisma include shape.
const fetchPairedClientRecords = (
  where: { created_by_account_id: string; is_hidden: boolean },
  take: number,
  skip: number
) =>
  DB_CLIENT.use.galleryRecord.findMany({
    where,
    include: { ...GALLERY_COLORS_TRAITS_SELECT },
    // Tiebreaker on gallery_record_id (cuid) — created_at is non-unique, so without it
    // records can swap positions between pages under stable pinned ordering.
    orderBy: [
      { is_pinned: 'desc' },
      { created_at: 'desc' },
      { gallery_record_id: 'desc' },
    ],
    take,
    skip,
  });

export const getGalleryForPairedClient_IO = async ({
  props,
  currentUserId,
}: {
  props: GALLERY_DTO_API_V1['GALLERY_GET_FOR_PAIRED_CLIENT']['REQUEST'];
  currentUserId: string;
}): Promise<
  OperationResult<
    GALLERY_DTO_API_V1['GALLERY_GET_FOR_PAIRED_CLIENT']['RESPONSE'],
    | GalleryRecordNotFoundError
    | PairingSessionNotFoundError
    | StylistNotFoundError
    | DatabaseError
  >
> => {
  const { stylist_account_id, limit, offset } = props;

  let account;
  let pair;
  try {
    // Account existence + pair check run in parallel (independent queries).
    [account, pair] = await Promise.all([
      // DECISION (nie usuwaj tego komentarza):
      // Stylist anchor gejtowany PELNYM dwuosiowym inwariantem STYLIST_PUBLICLY_VISIBLE
      // (account_status===ACTIVE ORAZ created_by_user.is_active===true), nie tylko
      // account_status. Bez osi created_by_user.is_active stan rozjechany self-disable
      // (USER_DISABLE_SELF / soft-delete, DOMAIN_SSOT §13.1: is_active=false ale
      // account_status moze pozostac ACTIVE) przepuszczal niewidocznego styliste →
      // paired client dostawal 200 z prywatna/nie-pinowana galeria (asset_url) + PII
      // (display_name/business_name/address_city) stylisty juz niepublicznego (axis-2
      // leak). Parytet z bookmarkStylist_IO i read-filtrem favorite-records (oba gejtuja
      // na STYLIST_PUBLICLY_VISIBLE). findFirst (nie findUnique) bo const laczy unique
      // account_id z non-unique account_status + relacja created_by_user.is_active. Brak
      // wiersza → istniejacy STYLIST_NOT_FOUND nizej (maskuje niewidocznego styliste,
      // parytet anty-enumeracji). Aktywna para nie jest tu kanalem-bypass: niepubliczny
      // stylista jest niewidoczny take dla sparowanego klienta.
      DB_CLIENT.use.stylistAccount.findFirst({
        where: {
          account_id: stylist_account_id,
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
      }),
      DB_CLIENT.use.clientStylistPair.findFirst({
        where: {
          client_user_id: currentUserId,
          stylist_account_id,
          status: PairingStatusValue.ACTIVE,
        },
        select: { id: true },
      }),
    ]);
  } catch (error) {
    return databaseFailure('getGalleryForPairedClient', error);
  }

  if (!account) {
    // DECISION (nie usuwaj tego komentarza):
    // stylistAccount.findFirst (gated on STYLIST_PUBLICLY_VISIBLE) returns null when
    // stylist_account_id is not a PUBLICLY VISIBLE stylist (a client account_id was passed,
    // OR the stylist is inactive/deleted/banned on either axis — account_status != ACTIVE
    // or created_by_user.is_active === false). GALLERY_RECORD_NOT_FOUND was misleading — no gallery lookup has happened yet.
    // STYLIST_NOT_FOUND is the correct semantic: the stylist anchor doesn't exist,
    // making any gallery or pairing check moot. Behaviour for a valid stylist with
    // no pairing is unchanged (PAIRING_SESSION_NOT_FOUND below).
    return failure({
      type: 'STYLIST_NOT_FOUND',
      stylistAccountId: stylist_account_id,
    });
  }

  if (!pair) {
    return failure({
      type: 'PAIRING_SESSION_NOT_FOUND',
      sessionId: '',
    });
  }

  const safeLimit = Math.min(limit || 50, 100);

  // DECISION (nie usuwaj tego komentarza):
  // BRAK plan-read-capa na liczbę rekordów — BY-DESIGN (DOMAIN_SSOT §4.2 „Pełna Galeria po
  // sparowaniu = WSZYSTKIE zdjęcia stylistki, dostępne po sparowaniu"). Sparowana klientka
  // (ACTIVE pairing = realna klientka stylistki) widzi PEŁNĄ, nie-hidden galerię niezależnie od
  // planu stylistki. `max_gallery_records` (pricing.policy) gejtuje TWORZENIE rekordów (write-quota),
  // NIE widoczność dla sparowanych. Po downgrade do Free rekordy persistują (persist-on-downgrade) i
  // sparowane klientki nadal je widzą — ukrycie już-utworzonego portfolio przed własnymi klientkami
  // stylistki łamałoby rdzeń produktu i nie ma spójnej monetyzacji. Jedyny plan-masked read tu to
  // `brand_accent_color` niżej (branding = JAWNY płatny entitlement `can_brand_profile`, S51), treść
  // galerii — celowo nie. Review cyklicznie flaguje to jako „monetization leak" — to NIE bug.
  const pairedClientWhere = {
    created_by_account_id: stylist_account_id,
    is_hidden: false, // Exclude records hidden by moderation
  };

  let totalCount: number;
  let records: Awaited<ReturnType<typeof fetchPairedClientRecords>>;
  try {
    [totalCount, records] = await Promise.all([
      DB_CLIENT.use.galleryRecord.count({ where: pairedClientWhere }),
      fetchPairedClientRecords(pairedClientWhere, safeLimit, offset || 0),
    ]);
  } catch (error) {
    return databaseFailure('getGalleryForPairedClient:fetchRecords', error);
  }

  return success({
    records: records.map(record => ({
      gallery_record_id: record.gallery_record_id,
      asset_url: record.asset_url,
      is_pinned: record.is_pinned,
      colors: mapGalleryColors(record.colors),
      traits: mapGalleryTraits(record.traits),
      nail_length: assertType(
        record.nail_length,
        isNailLengthNarrower,
        'nail_length in getGalleryForPairedClient_IO'
      ),
      created_at: record.created_at,
    })),
    total_count: totalCount,
    stylist_info: {
      account_id: account.account_id,
      display_name: account.display_name,
      business_name: account.business_name,
      address_city: account.address_city,
      // Branding-light krok 2: maska planu na read (parytet z public profile
      // i gallery-public — write-gate nie czyści kolumny przy downgrade, S51).
      brand_accent_color: PRICING_POLICY.LIMITS[
        narrowPricingPlan(account.pricing_plan)
      ].can_brand_profile
        ? account.brand_accent_color
        : null,
    },
  });
};
