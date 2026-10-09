import { DB_CLIENT } from '@app/db/db.client';
import { isP2025 } from '@app/db/prisma-error';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import {
  PRICING_POLICY,
  narrowPricingPlan,
} from '@kernel/policies/pricing.policy';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  AccountNotFoundError,
  DatabaseError,
} from '@kernel/application/common-errors.types';
import { shouldCountProfileView } from '@domain/account/profile-view-dedup';
import {
  STYLIST_PUBLICLY_VISIBLE,
  isAccountActive,
} from '@domain/account/account.config';
import { countPublicGalleryRecords } from '@domain/gallery/public-gallery-count';

export const getPublicStylistProfile_IO = async ({
  identifier,
}: {
  identifier: string;
}): Promise<
  OperationResult<
    ACCOUNT_DTO_API_V1['ACCOUNT_GET_PUBLIC_PROFILE']['RESPONSE'],
    AccountNotFoundError | DatabaseError
  >
> => {
  const accountSelect = {
    account_id: true,
    account_status: true,
    display_name: true,
    business_name: true,
    address_city: true,
    address_country: true,
    phone: true,
    website: true,
    description: true,
    vanity_url: true,
    view_count: true,
    instagram_handle: true,
    avatar_url: true,
    brand_accent_color: true,
    // pricing_plan tylko do MASKI brandingu niżej — nie leakuje do RESPONSE.
    pricing_plan: true,
    // Fallback chain (own upload → OAuth image → initials in the UI). The column has
    // a real write path since 2026-09-09 (account/set-avatar, SCHEMA_DECISIONS
    // stylistaccount-avatar) — both halves are live, so neither may be dropped: the
    // OAuth image still serves every account that never uploaded one, and clearing the
    // avatar is precisely a request to fall back to it.
    created_by_user: { select: { image: true } },
    // DECISION (nie usuwaj tego komentarza):
    // Denormalized counts replace _count: { select } subquery (D7+DD3-D1 run 24).
    // Maintained atomically in bookmarkStylist_IO / unbookmarkStylist_IO /
    // createGalleryRecord_IO / deleteGalleryRecord_IO / moderation DELETE path.
    // cached_likes_count (F2 PDH): single-owner write-path favorite-count.helper.ts
    // (favorite add/remove, gallery-delete, moderation HIDE/DELETE/BAN, pairing-revoke,
    // client-cascade) — zastępuje dawny live favoriteGalleryRecord.count dla total_likes.
    cached_bookmark_count: true,
    cached_likes_count: true,
  } as const;

  // DECISION (nie usuwaj tego komentarza):
  // DD2-M7 r28 → F2 PDH ZREALIZOWANE: profil to teraz JEDEN findFirst (zero osobnego
  // count). total_likes czytany z denormalizowanego `cached_likes_count` (parytet z
  // cached_gallery_count / cached_bookmark_count), utrzymywanego atomowo przez single-owner
  // write-path favorite-count.helper.ts. Wcześniej był osobny live favoriteGalleryRecord.count
  // (sekwencyjny, bo account_id rozwiązany dopiero po findFirst — `identifier` może być
  // account_id LUB vanity_url) — usunięty (zero dual-SoT z dashboard like_count).
  // 2026-09-25: wraca JEDEN count — `gallery_records_count` (prace, które odwiedzający
  // zobaczy), bo denormalizowany `cached_gallery_count` liczy całą galerię, także
  // nieprzypięte, więc nie jest liczbą publiczną. Count idzie po indeksie
  // (created_by_account_id, is_pinned, is_hidden) i jest ograniczony limitem pinów.
  //
  try {
    //
    // DECISION (nie usuwaj tego komentarza):
    // Public visibility contract = account_status=ACTIVE AND created_by_user.is_active=true
    // (SSOT: STYLIST_PUBLICLY_VISIBLE in account.config.ts). This op intentionally does NOT
    // spread that const: it selects account_status and checks it in JS (the `!account ||
    // account_status !== ACTIVE` guard below) so BOTH the not-found and the not-active cases
    // collapse to a single ACCOUNT_NOT_FOUND 404 (anti-enumeration). The is_active half stays in
    // the where so an inactive-user row is filtered at the DB. Defense-in-depth parity with
    // og-meta / public-stylists-list — without it a future path flipping only User.is_active
    // would leak identity (display_name+city+URL+avatar).
    // DECISION (nie usuwaj tego komentarza), s34 HIGH: the account id WINS over
    // a vanity. One `OR` query returned whichever row the scan met first, so a
    // vanity equal to another stylist's account_id could take over her public
    // profile, share link and printed QR. Id first (primary key), vanity only
    // when no account has that id; the vanity pre-flight also refuses ids.
    const activeOwner = { created_by_user: { is_active: true } } as const;
    const account =
      (await DB_CLIENT.use.stylistAccount.findFirst({
        where: { account_id: identifier, ...activeOwner },
        select: accountSelect,
      })) ??
      (await DB_CLIENT.use.stylistAccount.findFirst({
        where: { vanity_url: identifier, ...activeOwner },
        select: accountSelect,
      }));

    if (!account || !isAccountActive(account.account_status)) {
      return failure({ type: 'ACCOUNT_NOT_FOUND', accountId: identifier });
    }

    // Liczba prac = publiczny rozmiar portfolio (nieukryte prace, z bazy, nie z
    // cache); profil pokazuje „Wyróżnione (N) + jeszcze M” — DECISION w
    // public-gallery-count.ts. Osobny count po indeksie, bo `identifier` bywa
    // vanity_url i account_id znamy dopiero po findFirst.
    const galleryRecordsCount = await countPublicGalleryRecords(account);

    // DECISION (nie usuwaj tego komentarza):
    // total_likes = denormalized `cached_likes_count` (F2 PDH; wcześniej live
    // favoriteGalleryRecord.count z `record:{is_hidden:false}`). SoT licznika to lajki
    // WIDOCZNYCH rekordów (is_hidden:false) — write-path favorite-count.helper.ts utrzymuje
    // DOKŁADNIE ten sam moderation-visible zbiór co getFavoriteGrouped_IO /
    // getFavoriteRecords_IO (cached_gallery_count dekrementowany atomowo przy HIDE
    // w resolveContentReport_IO trzyma ten sam zbiór). HIDE ustawia
    // is_hidden=true i NIE usuwa wiersza FavoriteGalleryRecord (FK persists), ale helper
    // dekrementuje cached_likes_count o ukryte lajki — więc licznik nie zawyża i nie leakuje
    // istnienia ukrytej treści na PUBLICZNYM profilu. Drift recovery: cached-counts-backfill.ts.

    return success({
      account: {
        account_id: account.account_id,
        display_name: account.display_name,
        business_name: account.business_name,
        address_city: account.address_city,
        address_country: account.address_country,
        phone: account.phone,
        website: account.website,
        description: account.description,
        vanity_url: account.vanity_url,
        view_count: account.view_count,
        instagram_handle: account.instagram_handle,
        avatar_url:
          account.avatar_url ?? account.created_by_user?.image ?? null,
        // Maska planu przy ODCZYCIE (review S51): write-gate (BRANDING_PLAN_LOCKED)
        // nie czyści kolumny przy downgrade — bez maski była wartość ustawiona na
        // Pro Marka renderowałaby się po zejściu na Pro/Free (feature za paywallem
        // widoczny bez planu). Wartość ZOSTAJE w DB (wraca po re-upgrade).
        brand_accent_color: PRICING_POLICY.LIMITS[
          narrowPricingPlan(account.pricing_plan)
        ].can_brand_profile
          ? account.brand_accent_color
          : null,
      },
      gallery_records_count: galleryRecordsCount,
      bookmark_count: account.cached_bookmark_count,
      total_likes: account.cached_likes_count,
    });
  } catch (error) {
    return databaseFailure('getPublicStylistProfile_IO', error);
  }
};

export const incrementProfileView_IO = async ({
  stylist_account_id,
  client_ip,
  viewer_account_id,
}: {
  stylist_account_id: string;
  client_ip: string | null;
  viewer_account_id: string | null;
}): Promise<
  OperationResult<
    ACCOUNT_DTO_API_V1['ACCOUNT_INCREMENT_VIEW']['RESPONSE'],
    AccountNotFoundError | DatabaseError
  >
> => {
  try {
    // DECISION (nie usuwaj tego komentarza):
    // increment-view enforces the FULL public-visibility contract — account_status=ACTIVE
    // AND created_by_user.is_active=true (SSOT: STYLIST_PUBLICLY_VISIBLE in account.config.ts),
    // parity with getPublicStylistProfile_IO / gallery-public / og-meta. It only
    // counts/acknowledges views for PUBLICLY VISIBLE profiles. Without BOTH predicates,
    // increment-view returned 200 for EXPIRING/EXPIRED/NOT_ACTIVE stylists OR for the split
    // state (account_status=ACTIVE but the owning User.is_active=false) whose public profile
    // is 404 → a wider existence oracle than the adjacent public endpoints, plus view
    // inflation on hidden profiles. findUnique cannot combine the unique account_id with the
    // non-unique status / relation filters, so the dedup read uses findFirst and the mutation
    // uses updateMany (count === 0 ⇒ not visible / not found ⇒ ACCOUNT_NOT_FOUND). Spread (not
    // reference) so the const stays untouched while we add account_id.
    const activePredicate = {
      account_id: stylist_account_id,
      ...STYLIST_PUBLICLY_VISIBLE,
    } as const;

    // Self-view exclusion: an owner viewing their own profile must not inflate the
    // count. Takes the same "read & return current count" branch as the dedup hit.
    const isSelfView =
      viewer_account_id !== null && viewer_account_id === stylist_account_id;

    // Dedup: same IP + same target within 24h counts as one view
    if (isSelfView || !shouldCountProfileView(client_ip, stylist_account_id)) {
      // Return current view_count without incrementing
      const current = await DB_CLIENT.use.stylistAccount.findFirst({
        where: activePredicate,
        select: { view_count: true },
      });

      if (!current) {
        return failure({
          type: 'ACCOUNT_NOT_FOUND',
          accountId: stylist_account_id,
        });
      }

      return success({ view_count: current.view_count });
    }

    const updated = await DB_CLIENT.use.stylistAccount.updateMany({
      where: activePredicate,
      data: { view_count: { increment: 1 } },
    });

    if (updated.count === 0) {
      return failure({
        type: 'ACCOUNT_NOT_FOUND',
        accountId: stylist_account_id,
      });
    }

    // updateMany does not return rows; read back the new count for the response.
    const refreshed = await DB_CLIENT.use.stylistAccount.findFirst({
      where: activePredicate,
      select: { view_count: true },
    });

    if (!refreshed) {
      // Raced into non-ACTIVE between update and read — treat as not found.
      return failure({
        type: 'ACCOUNT_NOT_FOUND',
        accountId: stylist_account_id,
      });
    }

    return success({ view_count: refreshed.view_count });
  } catch (error) {
    // Prisma P2025 = record not found
    if (isP2025(error)) {
      return failure({
        type: 'ACCOUNT_NOT_FOUND',
        accountId: stylist_account_id,
      });
    }
    return databaseFailure('incrementProfileView_IO', error);
  }
};
