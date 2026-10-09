import { DB_CLIENT } from '@app/db/db.client';
import { lockActivePair, lockVisitRecord } from '@app/db/lock-rows';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { findForeignAssetOwner } from '@domain/_shared/guards/cloudinary-asset.guard';
import { cleanupCloudinaryAssets } from '@domain/gallery/operations/gallery-cloudinary-cleanup';
import type { ValidationError } from '@kernel/application/common-errors.types';
import type { OperationResult } from '@kernel/application/result.types';
import { failure, success } from '@kernel/application/result.types';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import { VISIT_CONFIG } from '@kernel/domain/visit/visit.config';
import type { VisitResultPhotoDTO } from '@kernel/models/visit/visit.dto';
import {
  mapPhotoToDTO,
  requireActivePairingLocked_IO,
  requireVisitAccess_IO,
  type VisitAccessError,
} from './visit-common.operations';
import { extractPublicIdFromUrl } from '@app/cloudinary/cloudinary-url.utils';

class VisitPhotoLimitRollback extends Error {
  constructor() {
    super('Visit result photo limit reached');
  }
}

// Wizyta zniknęła między requireVisitAccess_IO (poza tx) a lockiem — TOCTOU cascade-delete
// klientki (User onDelete:Cascade). Bez tego insert child z martwym FK → P2003 → opaque 500;
// mapujemy na czysty VISIT_NOT_FOUND (symetryczny z read/write-gate).
class VisitGoneRollback extends Error {
  constructor() {
    super('Visit removed before result photo insert');
  }
}

// Pairing revoked (status->REVOKED) between the outer requireVisitAccess_IO check and the in-tx
// lock. lockActivePair returns null → we abort the insert and mirror the pairing failure
// (CLIENT_UNAUTHORIZED_ACCESS) instead of writing a photo to a just-revoked client.
class PairingRevokedRollback extends Error {
  constructor() {
    super('Pairing revoked before result photo insert');
  }
}

export const addVisitResultPhoto_IO = async ({
  stylist_account_id,
  stylist_pricing_plan,
  visit_id,
  asset_url,
}: {
  stylist_account_id: string;
  stylist_pricing_plan: PricingPlan;
  visit_id: string;
  asset_url: string;
}): Promise<
  OperationResult<VisitResultPhotoDTO, VisitAccessError | ValidationError>
> => {
  const access = await requireVisitAccess_IO({
    visit_id,
    stylist_account_id,
    stylist_pricing_plan,
  });
  if (!access.success) {
    return access;
  }

  // DECISION (nie usuwaj tego komentarza):
  // `asset_url` przychodzi OD KLIENTA, a walidator sprawdza tylko prefiks domeny
  // Cloudinary — to za mało, bo z samego URL-a liczy się `public_id`, którym
  // kasuje się plik. Bez tej bramki dowolna stylistka mogła podpiąć pod swoją
  // wizytę URL wzięty z CUDZEJ publicznej galerii, a potem „usunąć zdjęcie"
  // i skasować cudzy plik w chmurze (potwierdzone w runtime). Odrzucamy więc URL,
  // który należy już do innego konta — w galerii albo w zdjęciach wizyt.
  // Drugą warstwą jest reference-check przy samym kasowaniu
  // (gallery-cloudinary-cleanup), bo ta bramka nie chroni wierszy sprzed jej
  // wprowadzenia. Ten sam URL W OBRĘBIE własnego konta przechodzi — to legalne
  // ponowne użycie własnego zdjęcia, a przed skasowaniem cudzego-własnego bloba
  // broni właśnie reference-check.
  const ownership = await findForeignAssetOwner(asset_url, stylist_account_id);
  if (ownership !== 'OWN') {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'asset_url',
      message:
        ownership === 'FOREIGN'
          ? 'Asset URL belongs to another account'
          : 'Asset URL is not a recognized Cloudinary upload address',
    });
  }

  try {
    const photo = await DB_CLIENT.use.$transaction(async tx => {
      // DECISION (nie usuwaj tego komentarza): pesymistyczny FOR UPDATE na wierszu-rodzicu
      // VisitRecord SERIALIZUJE wszystkich równoległych piszących fotki tej wizyty. Bez tego
      // `position = max(position)+1` liczony współbieżnie dawał ten sam numer dwóm transakcjom →
      // @@unique([visit_record_id, position]) P2002 → część batch-uploadu (multi-select fotek =
      // równoległe POSTy) padała opaque 500 z NIEzapisanym wierszem. Lock czyni count+position+create
      // atomowymi wobec innych piszących do TEJ wizyty, więc limit-check i przydział position są
      // deterministyczne (żaden retry ani finalCount-recheck nie jest już potrzebny).
      //
      // Revoke-race barrier: lock the ACTIVE pair FIRST (LOCK-ORDER ClientStylistPair BEFORE
      // VisitRecord — patrz lock-rows.ts DECISION, NIE odwracać), re-confirming the pairing under a
      // lock so a revoke committing after the outer requireVisitAccess_IO check aborts the insert.
      const pairLocked = await lockActivePair(
        tx,
        access.data.client_user_id,
        stylist_account_id,
        { requireActiveClient: true }
      );
      if (!pairLocked) {
        throw new PairingRevokedRollback();
      }

      const locked = await lockVisitRecord(tx, visit_id);
      if (!locked) {
        throw new VisitGoneRollback();
      }

      // One aggregate returns BOTH the limit-check count and the max position in a
      // single round-trip under the row lock (was: separate count() + aggregate() on
      // the identical where) — shorter lock-hold, fewer serialized round-trips in the
      // hot insert path. Values are identical to the two-query form.
      const stats = await tx.visitResultPhoto.aggregate({
        where: { visit_record_id: visit_id },
        _count: true,
        _max: { position: true },
      });
      if (stats._count >= VISIT_CONFIG.RESULT_PHOTOS_MAX_PER_VISIT) {
        throw new VisitPhotoLimitRollback();
      }
      const nextPosition = (stats._max.position ?? -1) + 1;

      return tx.visitResultPhoto.create({
        data: {
          visit_record_id: visit_id,
          stylist_account_id,
          asset_url,
          // `public_id` zapisujemy RAZEM z adresem — bramka własności pliku pyta o niego
          // indeksem zamiast skanować całą kolumnę adresów. `null` = adresu nie dało się
          // rozłożyć; taki wiersz zostaje na wolniejszej ścieżce porównania w kodzie i
          // NADAL chroni swój plik (patrz cloudinary-asset.guard.ts).
          public_id: extractPublicIdFromUrl(asset_url),
          position: nextPosition,
        },
      });
    });

    return success(mapPhotoToDTO(photo));
  } catch (error) {
    if (error instanceof VisitPhotoLimitRollback) {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'result_photos',
        message: 'Visit result photo limit reached',
      });
    }
    if (error instanceof VisitGoneRollback) {
      return failure({ type: 'VISIT_NOT_FOUND', visitId: visit_id });
    }
    if (error instanceof PairingRevokedRollback) {
      return failure({
        type: 'CLIENT_UNAUTHORIZED_ACCESS',
        clientId: access.data.client_user_id,
        stylistAccountId: stylist_account_id,
      });
    }
    return databaseFailure('addVisitResultPhoto_IO', error);
  }
};

// Zbiera asset_url wszystkich VisitResultPhoto powiązanych z userem (jako klientka LUB stylistka)
// dla Cloudinary-cleanup PRZED terminal-delete konta. Bez tego cascade kasuje wiersze VisitResultPhoto,
// a bloby zostają osierocone w Cloudinary (parytet z gallery-cleanup). Best-effort: błąd zwraca [] —
// cleanup jest fire-and-forget i NIE może zablokować usunięcia konta.
export const collectVisitResultPhotoUrlsForUser_IO = async (
  userId: string
): Promise<string[]> => {
  try {
    const photos = await DB_CLIENT.use.visitResultPhoto.findMany({
      where: {
        OR: [
          { visit_record: { client_user_id: userId } },
          { visit_record: { stylist_account: { created_by_user_id: userId } } },
        ],
      },
      select: { asset_url: true },
      take: 5000, // Safety cap — mirror gallery collection
    });
    return photos.map(p => p.asset_url);
  } catch (error) {
    // Best-effort ZOSTAJE (pusta lista nie blokuje kasowania konta), ale nie po
    // cichu: bez śladu bloby sierocieją w Cloudinary i nikt się o tym nie dowie.
    reportIssueBackend({
      namespace: 'visit-result-photo-cleanup',
      message: `Could not collect visit result photo URLs before account delete: ${userId}`,
      payload: {
        error: error instanceof Error ? error.message : String(error),
      },
      mode: 'warn',
    });
    return [];
  }
};

export const removeVisitResultPhoto_IO = async ({
  stylist_account_id,
  stylist_pricing_plan,
  visit_id,
  photo_id,
}: {
  stylist_account_id: string;
  stylist_pricing_plan: PricingPlan;
  visit_id: string;
  photo_id: string;
}): Promise<OperationResult<{ success: true }, VisitAccessError>> => {
  const access = await requireVisitAccess_IO({
    visit_id,
    stylist_account_id,
    stylist_pricing_plan,
    // Kasowanie nie oddaje treści — cutoff retencji go nie dotyczy (DECISION przy cutoffie).
    purpose: 'destructive',
  });
  if (!access.success) {
    return access;
  }

  try {
    // Blob zbierany PRZED kasowaniem wiersza — bez tego URL przepada i zdjęcie zostaje
    // osierocone w Cloudinary (parytet z terminal-delete konta). Cleanup fire-and-forget
    // PO udanej transakcji.
    let orphanedAssetUrl: string | null = null;

    // Revoke-race barrier: re-confirm ACTIVE pairing UNDER A ROW LOCK in the SAME tx as the
    // delete, so a revoke committing after the outer requireVisitAccess_IO check cannot mutate a
    // just-revoked client's visit photos.
    const outcome: OperationResult<{ success: true }, VisitAccessError> =
      await DB_CLIENT.use.$transaction(async tx => {
        const barrier = await requireActivePairingLocked_IO(
          tx,
          access.data.client_user_id,
          stylist_account_id
        );
        if (!barrier.success) {
          return barrier;
        }

        const photo = await tx.visitResultPhoto.findFirst({
          where: {
            id: photo_id,
            visit_record_id: visit_id,
            stylist_account_id,
          },
          select: { asset_url: true },
        });

        const result = await tx.visitResultPhoto.deleteMany({
          where: {
            id: photo_id,
            visit_record_id: visit_id,
            stylist_account_id,
          },
        });
        if (result.count === 0) {
          return failure({ type: 'VISIT_NOT_FOUND', visitId: visit_id });
        }
        orphanedAssetUrl = photo?.asset_url ?? null;
        return success({ success: true as const });
      });

    if (outcome.success && orphanedAssetUrl !== null) {
      cleanupCloudinaryAssets([orphanedAssetUrl]);
    }
    return outcome;
  } catch (error) {
    return databaseFailure('removeVisitResultPhoto_IO', error);
  }
};
