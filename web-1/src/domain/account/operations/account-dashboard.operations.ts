import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { VISIBLE_PINNED_GALLERY_RECORD_WHERE } from '@domain/gallery/gallery-record-visibility';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  DatabaseError,
  StylistNotFoundError,
} from '@kernel/application/common-errors.types';
import {
  PairingStatusValue,
  SessionContainerLifecycleStateValue,
} from '@kernel/models/db_models.generated.dto';
import { computeGalleryStrength_IO } from './account-gallery-strength.operations';

// DECISION (nie usuwaj tego komentarza):
// DD2-H5 r28 → F2 PDH: like_count czytany z denormalizowanego `cached_likes_count` na
// StylistAccount (parytet z cached_gallery_count / cached_bookmark_count). Wcześniej każdy
// load dashboardu robił pełny FavoriteGalleryRecord index scan z cross-relation filtrem
// (record.created_by_account_id, is_hidden:false) — drogi dla prolific stylists (1000s
// rekordów, 10k+ lajków), łatany 60s TTL cache. Teraz licznik jest utrzymywany atomowo
// (single owner write-path) przez favorites/operations/favorite-count.helper.ts
// (increment/decrement w $transaction przy add/remove favorite, gallery-delete, moderation
// HIDE/DELETE/BAN, pairing-revoke, client-cascade). SoT licznika = lajki WIDOCZNYCH rekordów
// (is_hidden:false) — TEN SAM zbiór co dawny live-count i co publiczny total_likes
// (account-profile.operations.ts), więc dashboard like_count == publiczny profil. Drift
// recovery: cached-counts-backfill.ts (ten sam predykat). Cache TTL + live-count IIFE
// usunięte (zero dual-SoT).

type DashboardFeedResponse =
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_DASHBOARD_FEED']['RESPONSE'];

export const getDashboardFeed_IO = async ({
  stylist_account_id,
}: {
  stylist_account_id: string;
}): Promise<
  OperationResult<DashboardFeedResponse, DatabaseError | StylistNotFoundError>
> => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      recentGalleryRecords,
      activePairsCount,
      pendingSharesCount,
      stylistAccount,
      recentBookmarksCount,
      pinnedCount,
    ] = await Promise.all([
      // Recent gallery records (last 5)
      DB_CLIENT.use.galleryRecord.findMany({
        where: { created_by_account_id: stylist_account_id },
        orderBy: { created_at: 'desc' },
        take: 5,
        select: {
          gallery_record_id: true,
          asset_url: true,
          created_at: true,
        },
      }),
      // Active pairs count
      DB_CLIENT.use.clientStylistPair.count({
        where: {
          stylist_account_id,
          status: PairingStatusValue.ACTIVE,
        },
      }),
      // Pending shared sessions count (not expired)
      DB_CLIENT.use.sessionContainer.count({
        where: {
          stylist_account_id,
          lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
          expires_at: { gt: new Date() },
        },
      }),
      // Total view_count + created_at + denormalized counts from StylistAccount
      DB_CLIENT.use.stylistAccount.findUnique({
        where: { account_id: stylist_account_id },
        select: {
          view_count: true,
          created_at: true,
          cached_gallery_count: true,
          cached_likes_count: true,
          gallery_strength_dismissed_at: true,
        },
      }),
      // Recent bookmarks count (last 30 days)
      DB_CLIENT.use.favoriteStylist.count({
        where: {
          stylist_account_id,
          created_at: { gte: thirtyDaysAgo },
        },
      }),
      // Przypięte i widoczne prace = to, co realnie widzi klientka na wizytówce.
      // Ten sam filtr co publiczny endpoint galerii (is_pinned + !is_hidden), żeby
      // samouczek i profil publiczny nie mogły się rozjechać. Dokładane do
      // istniejącego Promise.all, więc kosztuje jedno równoległe zapytanie, nie rundę.
      DB_CLIENT.use.galleryRecord.count({
        where: {
          created_by_account_id: stylist_account_id,
          ...VISIBLE_PINNED_GALLERY_RECORD_WHERE,
        },
      }),
    ]);

    if (!stylistAccount) {
      return failure({
        type: 'STYLIST_NOT_FOUND',
        stylistAccountId: stylist_account_id,
      });
    }

    // photo_count = SSOT cached_gallery_count (dekrementowany przy HIDE/DELETE/BAN moderacji) —
    // ten sam licznik co publiczny profil (account-profile gallery_records_count) i lista publiczna.
    // DECISION (nie usuwaj tego komentarza): NIE surowy galleryRecord.count — liczyłby też ukryte
    // (is_hidden) rekordy, rozjeżdżając dashboardowy photo_count z publicznym (RC-011 drift) ORAZ
    // z like_count (is_hidden:false). Cached licznik jest autorytatywnym źródłem photo_count.
    const photoCount = stylistAccount.cached_gallery_count;

    // DECISION (nie usuwaj tego komentarza):
    // computeGalleryStrength_IO robi WŁASNY findUnique na StylistAccount (profile-
    // completeness: display_name/description/address_city/image + view_count), więc dashboard
    // czyta ten wiersz dwa razy (tu view_count + cached_*, tam profil). ŚWIADOMIE NIE
    // injektujemy pól profilu przez `precomputed`: ten kanał jest zarezerwowany dla DROGICH
    // COUNT-agregatów (galleryCount/activePairCount — cały sens denormalizacji DD2-H5, gdzie
    // count na prolific stylist był kosztowny). Drugi odczyt to tani indexed-PK findUnique
    // (~1ms), a rozszerzanie precompute na niego sprzęgłoby dashboard z wewnętrznymi polami
    // gallery-strength i rozmyłoby granicę reusable-bloku (koszt sprzężenia > zysk ~1ms).
    // NIE podnoś ponownie „double account read" — to celowy trade-off, nie przeoczenie.
    const galleryStrengthResult = await computeGalleryStrength_IO(
      stylist_account_id,
      { galleryCount: photoCount, activePairCount: activePairsCount }
    );
    const galleryStrengthScore = galleryStrengthResult.success
      ? galleryStrengthResult.data.score
      : 0;

    return success({
      gallery_strength_score: galleryStrengthScore,
      // Front pokazuje kartę mimo znacznika, gdy wynik spadnie poniżej 100% —
      // patrz DECISION przy dismissGalleryStrength_IO.
      gallery_strength_dismissed:
        stylistAccount.gallery_strength_dismissed_at !== null,
      total_views: stylistAccount.view_count ?? 0,
      active_pairs_count: activePairsCount,
      pending_shares_count: pendingSharesCount,
      recent_bookmarks_count: recentBookmarksCount,
      recent_gallery_records: recentGalleryRecords.map(record => ({
        gallery_record_id: record.gallery_record_id,
        image_url: record.asset_url,
        created_at: record.created_at.toISOString(),
      })),
      // Extended stats
      photo_count: photoCount,
      pinned_count: pinnedCount,
      // like_count = denormalized cached_likes_count (single owner: favorite-count.helper.ts).
      // Same is_hidden:false visible-likes SoT as publiczny profil total_likes — patrz DECISION
      // na górze pliku. NIE surowy favoriteGalleryRecord.count (drogie + dual-SoT drift).
      like_count: stylistAccount.cached_likes_count,
      paired_client_count: activePairsCount,
      member_since: stylistAccount.created_at.toISOString(),
      profile_view_count: stylistAccount.view_count ?? 0,
    });
  } catch (error) {
    return databaseFailure('getDashboardFeed_IO', error);
  }
};
