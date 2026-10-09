import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { IDType } from '@kernel/application/application.types';
import type { GalleryRecord } from '@kernel/models/db_models.generated.dto';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import {
  GALLERY_COLORS_TRAITS_SELECT,
  mapGalleryColors,
  mapGalleryTraits,
} from '@domain/gallery/gallery.utils.api';
import { isP2025 } from '@app/db/prisma-error';
import { lockGalleryRecord } from '@app/db/lock-rows';
import {
  assertType,
  hasCode,
  isNailLengthNarrower,
} from '@kernel/models/type_narrowing';
import type { TraitCategory } from '@kernel/models/db_models.manual.dto';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { GalleryRecordNotFoundError } from '@kernel/domain/gallery/gallery-errors.types';
import type {
  ValidationError,
  DatabaseError,
} from '@kernel/application/common-errors.types';

/**
 * Update an existing gallery record — replaces color/trait junctions
 */
export const updateGalleryRecord_IO = async ({
  props,
  id,
}: {
  props: {
    created_by_account_id: IDType;
    gallery_record_id: GalleryRecord['gallery_record_id'];
    color_ids?: string[];
    trait_ids?: string[];
    nail_length?: NailLength;
  };
  id: IDType;
}): Promise<
  OperationResult<
    {
      gallery_record_id: string;
      nail_length: NailLength;
      colors: Array<{ id: string; name: string; hex_code: string }>;
      traits: Array<{
        id: string;
        name: string;
        category: TraitCategory;
        icon_url: string | null;
        is_featured: boolean;
      }>;
    },
    // DECISION (nie usuwaj tego komentarza): brak GalleryRecordOwnershipError w unii —
    // cudzy rekord jest maskowany jako GALLERY_RECORD_NOT_FOUND (anti-enumeration, patrz
    // DECISION przy gałęzi OWNERSHIP niżej). Op nigdy nie zwraca OWNERSHIP_ERROR do klienta.
    GalleryRecordNotFoundError | ValidationError | DatabaseError
  >
> => {
  const {
    created_by_account_id,
    gallery_record_id,
    color_ids: rawColorIds,
    trait_ids: rawTraitIds,
    nail_length,
  } = props;

  if (!created_by_account_id) {
    reportIssueBackend({
      namespace: 'updateGalleryRecord_IO',
      message: `accountID ${created_by_account_id}`,
      payload: props,
      mode: 'error',
    });
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'created_by_account_id',
      message: 'Missing account ID',
    });
  }

  // DECISION (nie usuwaj tego komentarza):
  // CURATION GATE (parytet z gallery-create.operation.ts L177-222) — color_id/trait_id
  // muszą wskazywać AKTYWNE wpisy słownika. `is_active=false` to admin-mechanizm RETIRE
  // (znika z pickera GET_COLORS/GET_TRAITS, które filtrują `where:{is_active:true}`).
  // Sama junction createMany gwarantuje TYLKO istnienie FK (P2003) — NIE egzekwuje
  // is_active — więc stylistka trzymająca retired-id (cache, starszy rekord) mogła go
  // doczepić przy edycji, omijając kurację (create już to blokuje, update nie blokował →
  // rozjazd parytetu: retired-ale-istniejące id przechodziło 200 zamiast 400). Pre-walidacja
  // tu: jeden index-backed findMany per słownik (id IN ..., is_active:true) po deduped-secie.
  // Niezgodność liczności = co najmniej jedno id nieistniejące LUB retired → VALIDATION_ERROR
  // (4xx) PRZED tx (ten sam typed-error i komunikaty co create-side, single SoT). Walidujemy
  // TYLKO słowniki realnie podane w tym partial-update (rawColorIds/rawTraitIds !== undefined);
  // pusta tablica jest odrzucana wcześniej przez validator. Poza tx (reference-data read).
  // ACCEPTED RESIDUAL (TOCTOU): retire w okamgnieniu między tą walidacją a createMany nadal
  // przejdzie — tożsame, ograniczone ryzyko jak po stronie create; P2003-catch niżej zostaje
  // siatką bezpieczeństwa dla węższego przypadku id USUNIĘTEGO między pre-checkiem a zapisem.
  try {
    if (rawColorIds !== undefined) {
      const color_ids = [...new Set(rawColorIds)];
      if (color_ids.length > 0) {
        const activeColors = await DB_CLIENT.use.color.findMany({
          where: { id: { in: color_ids }, is_active: true },
          select: { id: true },
        });
        if (activeColors.length !== color_ids.length) {
          reportIssueBackend({
            namespace: 'updateGalleryRecord_IO',
            message: `Rejected update: one or more color_ids are inactive/non-existent for account ${created_by_account_id}`,
            payload: { created_by_account_id, gallery_record_id, color_ids },
            mode: 'info',
          });
          return failure({
            type: 'VALIDATION_ERROR',
            field: 'color_ids',
            message: 'One or more colors are unavailable',
          });
        }
      }
    }

    if (rawTraitIds !== undefined) {
      const trait_ids = [...new Set(rawTraitIds)];
      if (trait_ids.length > 0) {
        const activeTraits = await DB_CLIENT.use.trait.findMany({
          where: { id: { in: trait_ids }, is_active: true },
          select: { id: true },
        });
        if (activeTraits.length !== trait_ids.length) {
          reportIssueBackend({
            namespace: 'updateGalleryRecord_IO',
            message: `Rejected update: one or more trait_ids are inactive/non-existent for account ${created_by_account_id}`,
            payload: { created_by_account_id, gallery_record_id, trait_ids },
            mode: 'info',
          });
          return failure({
            type: 'VALIDATION_ERROR',
            field: 'trait_ids',
            message: 'One or more style traits are unavailable',
          });
        }
      }
    }
  } catch (error) {
    return databaseFailure(
      'updateGalleryRecord_IO:reference-validation',
      error
    );
  }

  // Partial update: ownership check + mutations inside single transaction (TOCTOU fix)
  let result;
  try {
    result = await DB_CLIENT.use.$transaction(async tx => {
      // Check existence and ownership inside transaction. The read TAKES a row lock so
      // concurrent edits of the same record serialize: the junction replace below is
      // delete-then-create, and two interleaved replaces collided on the link tables'
      // unique pair (P2002 → 500). Rationale: DECISION at lockGalleryRecord.
      const existing = await lockGalleryRecord(tx, gallery_record_id);

      if (!existing) {
        return { error: 'NOT_FOUND' as const };
      }

      if (existing.created_by_account_id !== created_by_account_id) {
        return {
          error: 'OWNERSHIP' as const,
          ownerId: existing.created_by_account_id,
        };
      }

      // Replace color junctions only if color_ids provided
      if (rawColorIds !== undefined) {
        const color_ids = [...new Set(rawColorIds)];
        await tx.galleryRecordColor.deleteMany({
          where: { gallery_record_id },
        });
        if (color_ids.length > 0) {
          await tx.galleryRecordColor.createMany({
            data: color_ids.map(color_id => ({ gallery_record_id, color_id })),
          });
        }
      }

      // Replace trait junctions only if trait_ids provided
      if (rawTraitIds !== undefined) {
        const trait_ids = [...new Set(rawTraitIds)];
        await tx.galleryRecordTrait.deleteMany({
          where: { gallery_record_id },
        });
        if (trait_ids.length > 0) {
          await tx.galleryRecordTrait.createMany({
            data: trait_ids.map(trait_id => ({ gallery_record_id, trait_id })),
          });
        }
      }

      // Update record fields (only nail_length if provided)
      // DD3-F2: include → select for colors/traits (drop junction columns we don't need)
      const updated = await tx.galleryRecord.update({
        data: {
          ...(nail_length !== undefined && { nail_length }),
        },
        where: {
          gallery_record_id,
          created_by_account_id,
        },
        select: {
          gallery_record_id: true,
          nail_length: true,
          ...GALLERY_COLORS_TRAITS_SELECT,
        },
      });

      return { error: null as null, updated };
    });
  } catch (error) {
    // DECISION (nie usuwaj tego komentarza):
    // P2003 (foreign-key violation) on the deleteMany+createMany junction replace means
    // the client sent a well-formed but non-existent color_id/trait_id. Color/trait IDs
    // are client input from a dictionary (Color/Trait) that can go stale — bogus IDs are
    // bad INPUT, not a DB outage. Map to VALIDATION_ERROR (HTTP 4xx) and log as mode:'info',
    // NOT through databaseFailure (which logs mode:'error' + full stack and would pollute the
    // anomaly/error monitoring channel as if Postgres were down). Mirrors the create-side
    // P2003 branch (gallery-create.operation.ts) for parity — update lacks an active-reference
    // pre-validation, so this catch is the existence guard here. Throwing inside $transaction
    // rolls back the whole replace, so the record's colors/traits/nail_length are unchanged.
    if (hasCode(error) && error.code === 'P2003') {
      reportIssueBackend({
        namespace: 'updateGalleryRecord_IO',
        message: `Invalid color_id/trait_id (FK P2003) for account ${created_by_account_id}`,
        payload: { created_by_account_id, gallery_record_id },
        mode: 'info',
      });
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'color_ids/trait_ids',
        message: 'One or more color or trait IDs do not exist',
      });
    }

    // DECISION (nie usuwaj tego komentarza):
    // P2025 (record-not-found on required write) — the in-TX findUnique (L~153)
    // confirmed the record, but a concurrent DELETE (owner second tab / moderation
    // resolve-report) can remove it before the `update` (singular) at the end of the
    // TX under READ COMMITTED → `update` matches 0 rows → P2025. Without this the
    // nail_length-only path (no junction createMany, so no P2003 to intercept it)
    // falls through to databaseFailure → HTTP 500 + mode:'error' (false Postgres-down
    // alarm) instead of a clean 404. Map to GALLERY_RECORD_NOT_FOUND — parity with
    // unpinGalleryRecord_IO (gallery-pin) and gallery-delete, and with the
    // anti-enumeration mask (vanished mid-flight ⟺ not-found). Structural detector
    // (isP2025, Turbopack-safe) not instanceof.
    if (isP2025(error)) {
      return failure({
        type: 'GALLERY_RECORD_NOT_FOUND',
        recordId: gallery_record_id,
      });
    }

    return databaseFailure('updateGalleryRecord', error);
  }

  // DECISION (nie usuwaj tego komentarza):
  // ANTI-ENUMERATION MASK (IDOR existence-oracle) — gdy rekord ISTNIEJE, ale należy do
  // innej stylistki, zwracamy DOKŁADNIE ten sam GALLERY_RECORD_NOT_FOUND (404) co dla
  // rekordu nieistniejącego, zamiast OWNERSHIP_ERROR (403). 403-vs-404 zdradzał istnienie
  // cudzego rekordu (oracle: 403 = istnieje-nie-twój, 404 = nie istnieje), pozwalając
  // przeczesać przestrzeń ID. Po masce obie ścieżki są nieodróżnialne dla klienta. Próbę
  // logujemy server-side (mode:'error', z ownerId) dla forensyki — to kanał wewnętrzny,
  // nie wycieka do odpowiedzi. Marker 'OWNERSHIP' w tx zostaje (niesie ownerId do logu),
  // mapowanie na 404 dzieje się tu, na granicy odpowiedzi. Parytet z gallery-delete /
  // gallery-pin (ta sama maska). Ownership-check nadal PO RBAC (sesja → stylist account).
  if (result.error === 'OWNERSHIP') {
    reportIssueBackend({
      namespace: 'updateGalleryRecord_IO',
      message: `Unauthorized update attempt (masked as 404). Owner: ${result.ownerId}, Requester: ${created_by_account_id}`,
      payload: { gallery_record_id, id },
      mode: 'error',
    });
  }

  if (result.error === 'NOT_FOUND' || result.error === 'OWNERSHIP') {
    return failure({
      type: 'GALLERY_RECORD_NOT_FOUND',
      recordId: gallery_record_id,
    });
  }

  const { updated } = result;

  reportIssueBackend({
    namespace: 'updateGalleryRecord_IO',
    message: `Gallery record updated successfully: ${gallery_record_id}`,
    payload: { gallery_record_id, id },
    mode: 'info',
  });

  return success({
    gallery_record_id: updated.gallery_record_id,
    nail_length: assertType(
      updated.nail_length,
      isNailLengthNarrower,
      'nail_length in updateGalleryRecord_IO'
    ),
    colors: mapGalleryColors(updated.colors),
    traits: mapGalleryTraits(updated.traits),
  });
};
