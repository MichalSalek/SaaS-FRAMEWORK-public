import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { hasCode } from '@kernel/models/type_narrowing';
import type { IDType } from '@kernel/application/application.types';
import type { GalleryRecord } from '@kernel/models/db_models.generated.dto';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type { PlanConfigType } from '@kernel/policies/pricing.policy';
import {
  isUnlimitedLimit,
  PRICING_POLICY,
} from '@kernel/policies/pricing.policy';
import { getPlanConfig } from '@app/pricing/plan-config.cache';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { GalleryLimitReachedError } from '@kernel/domain/gallery/gallery-errors.types';
import type {
  AccountNotFoundError,
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { cleanupCloudinaryAsset } from './gallery-cloudinary-cleanup';
import { incrementGalleryCount } from './gallery-count.helper';
import { extractPublicIdFromUrl } from '@app/cloudinary/cloudinary-url.utils';
import { findForeignAssetOwner } from '@domain/_shared/guards/cloudinary-asset.guard';
import { acquireAdvisoryXactLock } from '@app/db/lock-rows';

type CreateGalleryRecordArgs = {
  props: {
    created_by_account_id: IDType;
    asset_url: string;
    color_ids: string[];
    trait_ids: string[];
    nail_length: NailLength;
  };
  id: IDType;
};

type CreateGalleryRecordResult = OperationResult<
  GalleryRecord,
  | GalleryLimitReachedError
  | AccountNotFoundError
  | ValidationError
  | DatabaseError
>;

/**
 * Sentinel rollback error for the gallery-create transaction.
 *
 * Rzucany z wnętrza Prisma `$transaction`, by wymusić rollback całej tx, gdy
 * POST-create verify wykryje przekroczenie limitu w wyścigu współbieżnych insertów.
 * Łapany w zewnętrznym catch przez `instanceof` i mapowany na GALLERY_LIMIT_REACHED,
 * nie na DATABASE_ERROR. Typowana klasa zamiast magic-string sentinel — wzorzec:
 * pairing-rollback.helper.ts (PairingLimitExceededRollback).
 */
class GalleryQuotaRaceRollback extends Error {
  constructor() {
    super('Gallery quota race detected');
  }
}

/**
 * Create a new gallery record with color/trait junction records.
 * Wrapped by createGalleryRecord_IO which adds Cloudinary orphan cleanup (B14).
 */
const runCreateGalleryRecord = async ({
  props,
  id,
}: CreateGalleryRecordArgs): Promise<CreateGalleryRecordResult> => {
  const {
    created_by_account_id,
    asset_url,
    color_ids: rawColorIds,
    trait_ids: rawTraitIds,
    nail_length,
  } = props;

  // Deduplicate IDs to prevent unique constraint violations
  const color_ids = [...new Set(rawColorIds)];
  const trait_ids = [...new Set(rawTraitIds)];

  if (!created_by_account_id || !asset_url) {
    reportIssueBackend({
      namespace: 'createGalleryRecord_IO',
      message: `!created_by_account_id || !asset_url. created_by_account_id: ${created_by_account_id} asset_url: ${asset_url}`,
      payload: { color_ids, trait_ids },
      mode: 'error',
    });
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'created_by_account_id',
      message: 'Missing required field',
    });
  }

  // DECISION (nie usuwaj tego komentarza):
  // `asset_url` przychodzi OD KLIENTA (upload leci z przeglądarki wprost do
  // chmury), a walidator jądra potwierdza tylko, że adres wskazuje na nasz CDN
  // (`isCloudinaryAssetUrl`) — czyli dokładnie ten sam „prefiks domeny", który
  // okazał się niewystarczający przy zdjęciach wizyt i przy avatarze. Galeria
  // była TRZECIĄ powierzchnią przyjmującą cudzy adres i JEDYNĄ, która tej bramki
  // nie miała, a jest przy tym ŹRÓDŁEM adresów dla pozostałych dwóch: publiczny
  // profil wystawia `asset_url` wprost w HTML, więc wystarczyło skopiować cudzy
  // adres, żeby (a) wstawić cudzą pracę do własnego portfolio — kradzież
  // wizerunku pracy na produkcie, którego całą wartością jest „to moja robota" —
  // oraz (b) unieruchomić cudzy plik w chmurze: bramka referencyjna sinku
  // (gallery-cloudinary-cleanup) widzi wtedy żywe odniesienie napastnika i
  // odmawia kasowania, więc ofiara nie jest już w stanie usunąć własnego zdjęcia
  // od dostawcy ani przez skasowanie pracy, ani przez skasowanie konta.
  // Ten sam URL W OBRĘBIE własnego konta przechodzi tę bramkę (własny plik), a w
  // galerii kończy się oddaniem istniejącego rekordu (idempotencja po `public_id`,
  // DECISION w transakcji niżej) — jedna implementacja bramki dla wszystkich trzech
  // powierzchni: `_shared/guards/cloudinary-asset.guard`.
  const ownership = await findForeignAssetOwner(
    asset_url,
    String(created_by_account_id)
  );
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

  // DECISION (nie usuwaj tego komentarza):
  // Quota race prevention uses count-then-create + POST-CREATE VERIFY pattern.
  // Pre-check count gives fast-fail when clearly over limit; post-create count
  // inside the same transaction catches concurrent inserts that slipped past
  // pre-check (race window). If finalCount > limit we throw to trigger rollback.
  // This is more practical than SERIALIZABLE isolation (no deadlock risk,
  // works on standard Postgres isolation level).

  // DECISION (nie usuwaj tego komentarza):
  // The gallery cap is a PURE CODE INVARIANT = planConfig.max_gallery_records (per-plan
  // SSOT in PRICING_POLICY: FREE=5, paid=-1/unlimited). There is NO runtime override.
  // gallery-core-1b: the old MAX_GALLERY_RECORDS runtime knob (a GLOBAL override of the
  // FREE cap, seeded UNGATED at '50' and silently raising free users to 50 instead of 5 —
  // a bug, not a feature) was REMOVED from RUNTIME_CONFIG_KEYS (kernel). The matching
  // override-READ was removed from BOTH consumers here and in user-query.operations.ts: a
  // vestigial read of a now-unseeded key was dead, AND a latent risk — a stray/manual/stale
  // non-predefined runtimeConfig row (key=MAX_GALLERY_RECORDS, is_predefined=false) would
  // otherwise still override the cap, making the "FREE cap = 5" invariant depend on the
  // seed-prune having run rather than on code. The cap is now enforced solely from the
  // per-plan config, so display (user-query usage-stats) == enforcement by construction.
  // If a live-tunable gallery ceiling is ever genuinely needed, re-add it PROPERLY via
  // RUNTIME_CONFIG_KEYS (seeded, predefined, admin-validated) — not by reviving this read.
  // Pre-fetch immutable plan config OUTSIDE the transaction to keep the TX short; the quota
  // gate runs through the canonical PRICING_POLICY.utils.canCreateGalleryRecord predicate
  // (single SoT for "can add one more", handles the -1/unlimited sentinel) instead of an
  // inline `>=` comparison.
  let planConfig: PlanConfigType;
  let planLimit: number;
  let planType: PricingPlan;
  try {
    const account = await DB_CLIENT.use.stylistAccount.findUnique({
      where: { account_id: created_by_account_id },
      select: { pricing_plan: true },
    });
    if (!account) {
      reportIssueBackend({
        namespace: 'createGalleryRecord_IO',
        message: `Account not found: ${created_by_account_id}`,
        payload: { created_by_account_id },
        mode: 'error',
      });
      return failure({
        type: 'ACCOUNT_NOT_FOUND' as const,
        accountId: String(created_by_account_id),
      });
    }
    planConfig = await getPlanConfig(account.pricing_plan);
    planLimit = planConfig.max_gallery_records;
    planType = account.pricing_plan;
  } catch (error) {
    return databaseFailure('createGalleryRecord_IO:plan-lookup', error);
  }

  // DECISION (nie usuwaj tego komentarza):
  // CURATION GATE — color_id/trait_id must reference ACTIVE dictionary entries.
  // `is_active=false` is the admin mechanism to RETIRE a color/trait: it removes the
  // entry from the GET_COLORS/GET_TRAITS picker (getActiveColors/getActiveTraits filter
  // `where:{is_active:true}`). A nested junction create guarantees only FK EXISTENCE
  // (P2003) — it does NOT enforce is_active — so a stylist still holding a retired id
  // (cached client-side, or read from any older record) could keep attaching retired
  // entries to BRAND-NEW records, defeating curation. We pre-validate here that every
  // supplied id maps to an ACTIVE entry; a single `findMany` per dictionary (id IN ...,
  // is_active:true) over the deduped set is index-backed (@@index([is_active,...]) on
  // Color/Trait). A count mismatch means at least one id is non-existent OR retired ->
  // reject as VALIDATION_ERROR (4xx) before the quota tx (also avoids consuming the tx).
  // Run OUTSIDE the tx (reference-data read, same rationale as the plan pre-fetch above).
  // ACCEPTED RESIDUAL (TOCTOU): a color/trait retired in the instant between this check
  // and the create still slips onto the record — identical, bounded risk to the
  // by-design historical ghosting in gallery-list/detail (live join, no is_active filter)
  // and self-heals on the next edit. The P2003 catch below remains the safety net for
  // the narrower case of an id DELETED between check and create.
  // Scope: create-time only. Existing-record ghosting is acceptable-by-design (historical).
  try {
    if (color_ids.length > 0) {
      const activeColors = await DB_CLIENT.use.color.findMany({
        where: { id: { in: color_ids }, is_active: true },
        select: { id: true },
      });
      if (activeColors.length !== color_ids.length) {
        reportIssueBackend({
          namespace: 'createGalleryRecord_IO',
          message: `Rejected create: one or more color_ids are inactive/non-existent for account ${created_by_account_id}`,
          payload: { created_by_account_id, color_ids },
          mode: 'info',
        });
        return failure({
          type: 'VALIDATION_ERROR',
          field: 'color_ids',
          message: 'One or more colors are unavailable',
        });
      }
    }

    if (trait_ids.length > 0) {
      const activeTraits = await DB_CLIENT.use.trait.findMany({
        where: { id: { in: trait_ids }, is_active: true },
        select: { id: true },
      });
      if (activeTraits.length !== trait_ids.length) {
        reportIssueBackend({
          namespace: 'createGalleryRecord_IO',
          message: `Rejected create: one or more trait_ids are inactive/non-existent for account ${created_by_account_id}`,
          payload: { created_by_account_id, trait_ids },
          mode: 'info',
        });
        return failure({
          type: 'VALIDATION_ERROR',
          field: 'trait_ids',
          message: 'One or more style traits are unavailable',
        });
      }
    }
  } catch (error) {
    return databaseFailure(
      'createGalleryRecord_IO:reference-validation',
      error
    );
  }

  // Bramka własności wyżej zwraca OWN wyłącznie dla adresu z rozpoznanym
  // `public_id`, więc tu jest on zawsze obecny; `null` zostaje gałęzią obronną.
  const assetPublicId = extractPublicIdFromUrl(asset_url);

  try {
    const result = await DB_CLIENT.use.$transaction(async tx => {
      // DECISION (nie usuwaj tego komentarza) — 2026-09-25, idempotencja po pliku:
      // ten sam plik w chmurze (`public_id`) na TYM SAMYM koncie = ta sama praca, więc
      // drugi zapis oddaje istniejący rekord z tym samym sukcesem zamiast duplikatu.
      // Zamyka podwójne wysłanie formularza (podwójny tap, ponowienie po zerwanym
      // połączeniu) i przy okazji ponowne dodanie tego samego zdjęcia do galerii —
      // dwa rekordy jednego pliku to jedna praca liczona podwójnie w limicie planu.
      // Nie ma tu okna czasowego jak przy wizytach i wiadomościach, bo tożsamością
      // jest plik, nie treść: inna praca to zawsze inny upload, czyli inny `public_id`.
      // Bramka własności (cloudinary-asset.guard) NADAL przepuszcza własny plik —
      // to ta sama reguła, tylko rozstrzygnięta tu jako „oddaj istniejący", nie „utwórz".
      // Wyścig: blokada doradcza na (konto, public_id) w tej tx serializuje bliźniaki,
      // drugi po commicie pierwszego czyta już jego wiersz. Sprawdzenie stoi PRZED
      // bramką limitu, żeby powtórzone wysłanie przy pełnym limicie nie dostało
      // GALLERY_LIMIT_REACHED za pracę, która już jest zapisana.
      if (assetPublicId !== null) {
        await acquireAdvisoryXactLock(
          tx,
          `gallery-create:${String(created_by_account_id)}:${assetPublicId}`
        );
        const existingRecord = await tx.galleryRecord.findFirst({
          where: { created_by_account_id, public_id: assetPublicId },
          orderBy: { created_at: 'asc' },
        });
        if (existingRecord) {
          reportIssueBackend({
            namespace: 'createGalleryRecord_IO',
            message: `Duplicate create for an already stored asset — returning existing record for account ${created_by_account_id}`,
            payload: {
              gallery_record_id: existingRecord.gallery_record_id,
              id,
            },
            mode: 'info',
          });
          return success(existingRecord);
        }
      }

      const currentCount = await tx.galleryRecord.count({
        where: { created_by_account_id },
      });

      // Pre-check: fast-fail when clearly over limit (avoids needless create).
      // Canonical quota predicate (handles the -1/unlimited sentinel internally),
      // so the inline `>=` no longer diverges from the other 6 quota call-sites.
      if (
        !PRICING_POLICY.utils.canCreateGalleryRecord(planConfig, currentCount)
      ) {
        reportIssueBackend({
          namespace: 'createGalleryRecord_IO',
          message: `Gallery limit reached for account ${created_by_account_id}. Plan: ${planType}, Count: ${currentCount}/${planLimit}`,
          payload: {
            created_by_account_id,
            currentCount,
            limit: planLimit,
          },
          mode: 'info',
        });

        return failure({
          type: 'GALLERY_LIMIT_REACHED' as const,
          currentCount,
          limit: planLimit,
          planType,
        });
      }

      const createdRecord = await tx.galleryRecord.create({
        data: {
          created_by_account_id,
          asset_url,
          // `public_id` zapisujemy RAZEM z adresem — bramka własności pliku pyta o niego
          // indeksem zamiast skanować całą kolumnę adresów. `null` = adresu nie dało się
          // rozłożyć; taki wiersz zostaje na wolniejszej ścieżce porównania w kodzie i
          // NADAL chroni swój plik (patrz cloudinary-asset.guard.ts).
          public_id: assetPublicId,
          nail_length: nail_length ?? NAIL_LENGTHS.MEDIUM,
          colors: {
            create: color_ids.map(color_id => ({ color_id })),
          },
          traits: {
            create: trait_ids.map(trait_id => ({ trait_id })),
          },
        },
      });

      // DECISION (nie usuwaj tego komentarza):
      // Increment cached_gallery_count inside the SAME transaction as the create —
      // either both succeed or both rollback. Race-with-QUOTA path also rolls back the
      // increment (throw '__QUOTA_RACE__' → tx aborts → no drift). D7+DD3-D1 run 24.
      // Single SoT writer: gallery-count.helper.ts owns the whole cached_gallery_count
      // write-path (increment here + floored decrement on delete/moderation), so create
      // and delete share one canonical single-statement writer instead of an inline update.
      await incrementGalleryCount(tx, created_by_account_id, 1);

      // POST-CREATE VERIFY: re-count inside TX to detect concurrent race winners
      if (!isUnlimitedLimit(planLimit)) {
        const finalCount = await tx.galleryRecord.count({
          where: { created_by_account_id },
        });
        if (finalCount > planLimit) {
          // Throw to trigger rollback — caller handles QUOTA_EXCEEDED via catch
          throw new GalleryQuotaRaceRollback();
        }
      }

      reportIssueBackend({
        namespace: 'createGalleryRecord_IO',
        message: `Gallery record created successfully for account ${created_by_account_id}`,
        payload: { gallery_record_id: createdRecord.gallery_record_id, id },
        mode: 'info',
      });

      return success(createdRecord);
    });

    return result;
  } catch (error) {
    if (error instanceof GalleryQuotaRaceRollback) {
      reportIssueBackend({
        namespace: 'createGalleryRecord_IO',
        message: `Gallery limit race detected for account ${created_by_account_id} — rolled back. Plan: ${planType}, Limit: ${planLimit}`,
        payload: { created_by_account_id, planType, planLimit },
        mode: 'info',
      });
      return failure({
        type: 'GALLERY_LIMIT_REACHED' as const,
        currentCount: planLimit,
        limit: planLimit,
        planType,
      });
    }

    // DECISION (nie usuwaj tego komentarza):
    // P2003 (foreign-key violation) on the nested colors/traits create means the
    // client sent a well-formed but non-existent color_id/trait_id. Color/trait IDs
    // are client input from a dictionary (Color/Trait) that can go stale — bogus IDs
    // are bad INPUT, not a DB outage. Map to VALIDATION_ERROR (HTTP 4xx) and log as
    // `mode:'info'`, NOT through databaseFailure (which logs mode:'error' + full stack
    // and would pollute the anomaly/error monitoring channel as if Postgres were down).
    // Consistent with the project-wide "Prisma constraint -> 4xx" hardening; this junction
    // create path had been missed. The active-reference pre-validation above is the primary
    // existence+curation gate (deterministic 4xx, also enforces is_active which P2003 cannot);
    // this P2003 catch stays as the safety net for the narrow TOCTOU window where an id is
    // DELETED between that pre-check and the create.
    if (hasCode(error) && error.code === 'P2003') {
      reportIssueBackend({
        namespace: 'createGalleryRecord_IO',
        message: `Invalid color_id/trait_id (FK P2003) for account ${created_by_account_id}`,
        payload: { created_by_account_id, color_ids, trait_ids },
        mode: 'info',
      });
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'color_ids/trait_ids',
        message: 'One or more color or trait IDs do not exist',
      });
    }

    return databaseFailure('createGalleryRecord_IO', error);
  }
};

// DECISION (nie usuwaj tego komentarza):
// B14: asset Cloudinary jest wgrywany client-side (Step 1) PRZED tym wywołaniem (Step 2).
// Każdy failure (quota/validation/account/DB) zostawiłby osierocony asset w Cloudinary.
// Czyścimy go fire-and-forget (cleanupCloudinaryAsset ma retry/backoff) — single SoT
// pokrywający WSZYSTKIE gałęzie błędu, w tym GALLERY_LIMIT_REACHED (sprawdzany dopiero
// server-side po uploadzie). Success → asset zostaje. Brak asset_url → nic do czyszczenia.
export const createGalleryRecord_IO = async (
  args: CreateGalleryRecordArgs
): Promise<CreateGalleryRecordResult> => {
  const result = await runCreateGalleryRecord(args);
  if (!result.success && args.props.asset_url) {
    cleanupCloudinaryAsset(args.props.asset_url);
  }
  return result;
};
