import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { PairingStatusValue } from '@kernel/models/db_models.generated.dto';

// DECISION (nie usuwaj tego komentarza):
// gallery_strength_score is bundled into DASHBOARD_FEED response (see account.dto.ts).
// Standalone ACCOUNT_GET_GALLERY_STRENGTH endpoint was removed (superseded by feed),
// but this operation still exists as a reusable building block for the dashboard feed.
// The internal response shape is kept local because no consumer needs the DTO type.
type GalleryStrengthResponse = {
  score: number;
  breakdown: {
    gallery_records: number;
    profile_completeness: number;
    has_active_pair: number;
    has_views: number;
  };
};

/**
 * Computes gallery strength score for a stylist account.
 * Reused by dashboard feed (gallery_strength_score field).
 */
export const computeGalleryStrength_IO = async (
  stylist_account_id: string,
  precomputed?: { galleryCount?: number; activePairCount?: number }
): Promise<OperationResult<GalleryStrengthResponse, DatabaseError>> => {
  try {
    const [account, galleryCount, activePairCount] = await Promise.all([
      DB_CLIENT.use.stylistAccount.findUnique({
        where: { account_id: stylist_account_id },
        select: {
          display_name: true,
          description: true,
          address_city: true,
          view_count: true,
          avatar_url: true,
          created_by_user: {
            select: { image: true },
          },
        },
      }),
      precomputed?.galleryCount !== undefined
        ? precomputed.galleryCount
        : // DECISION (nie usuwaj tego komentarza): fallback (caller bez precomputed) liczy TYLKO
          // widoczne rekordy (is_hidden:false) — parytet z cached_gallery_count (visible-only SSOT),
          // którym karmi go jedyny obecny caller (dashboard). Bez tego standalone-recompute dałby
          // gallery-strength zawyżony o ukryte (moderowane) rekordy, rozjeżdżając się z publicznym
          // photo_count (ta sama klasa driftu RC-011 co naprawiona na warstwie dashboardu).
          DB_CLIENT.use.galleryRecord.count({
            where: {
              created_by_account_id: stylist_account_id,
              is_hidden: false,
            },
          }),
      precomputed?.activePairCount !== undefined
        ? precomputed.activePairCount
        : DB_CLIENT.use.clientStylistPair.count({
            where: {
              stylist_account_id,
              status: PairingStatusValue.ACTIVE,
            },
          }),
    ]);

    if (!account) {
      // Return zero score for non-existent account rather than error
      const emptyBreakdown: GalleryStrengthResponse = {
        score: 0,
        breakdown: {
          gallery_records: 0,
          profile_completeness: 0,
          has_active_pair: 0,
          has_views: 0,
        },
      };
      return success(emptyBreakdown);
    }

    // gallery_records: min(count * 15, 50) — max 50 pts for 4+ photos
    const galleryRecordsPts = Math.min(galleryCount * 15, 50);

    // profile_complete: has display_name (5) + has description/bio (5) + has city (5) + has profile_image_url (5) = max 20 pts
    let profilePts = 0;
    if (account.display_name) {
      profilePts += 5;
    }
    if (account.description) {
      profilePts += 5;
    }
    if (account.address_city) {
      profilePts += 5;
    }
    // Kanoniczny łańcuch zdjęcia profilowego: własny upload → obraz z OAuth.
    // Punkt liczył WYŁĄCZNIE obraz z OAuth, więc odkąd `avatar_url` ma ścieżkę
    // zapisu (2026-09-09), stylistka logująca się magic-linkiem mogła wgrać
    // zdjęcie i NIE dostać za nie punktu — pasek siły profilu twierdziłby, że
    // zdjęcia nie ma.
    if (account.avatar_url ?? account.created_by_user?.image) {
      profilePts += 5;
    }

    // has_any_active_pair: 10 pts
    const activePairPts = activePairCount > 0 ? 10 : 0;

    // view_count > 0: 10 pts
    // DD2-H8 r28: defensive nullish coalesce — schema today is non-nullable,
    // but Prisma aggregate types stay `number | null` (latent fragility).
    const hasViewsPts = (account.view_count ?? 0) > 0 ? 10 : 0;

    const rawScore =
      galleryRecordsPts + profilePts + activePairPts + hasViewsPts;
    const score = Math.min(rawScore, 100);

    return success({
      score,
      breakdown: {
        gallery_records: galleryRecordsPts,
        profile_completeness: profilePts,
        has_active_pair: activePairPts,
        has_views: hasViewsPts,
      },
    });
  } catch (error) {
    return databaseFailure('computeGalleryStrength', error);
  }
};

/**
 * Zapisuje decyzję stylistki o zamknięciu karty „Siła galerii".
 *
 * DECISION (nie usuwaj tego komentarza) — owner 2026-09-17:
 * Znacznik jest JEDNOKIERUNKOWY i nic go nie czyści. O pokazaniu karty
 * decyduje WYNIK: przy spadku poniżej 100% front pokazuje ją mimo znacznika,
 * bo wtedy znowu niesie zadanie do zrobienia. Czyszczenie kolumny przy
 * spadku wyglądałoby tak samo na ekranie, a kasowałoby fakt „stylistka to
 * zamknęła" — jedyną rzecz, której z wyniku nie da się odtworzyć.
 */
export const dismissGalleryStrength_IO = async (
  stylist_account_id: string
): Promise<
  OperationResult<
    { account_id: string; gallery_strength_dismissed_at: string },
    DatabaseError
  >
> => {
  try {
    const dismissedAt = new Date();
    const updated = await DB_CLIENT.use.stylistAccount.update({
      where: { account_id: stylist_account_id },
      data: { gallery_strength_dismissed_at: dismissedAt },
      select: { account_id: true },
    });

    return success({
      account_id: updated.account_id,
      // Kolumna jest nullowalna w schemacie, ale ten zapis właśnie ją ustawił.
      gallery_strength_dismissed_at: dismissedAt.toISOString(),
    });
  } catch (error) {
    return databaseFailure('dismissGalleryStrength', error);
  }
};
