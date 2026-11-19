/**
 * deleteManualVisit_IO unit tests — destrukcyjna operacja karty klientki.
 *
 * Locks in: ownership (another stylist cannot delete), the source=MANUAL guard (SESSION visits are
 * undeletable, anti-oracle VISIT_NOT_FOUND), the FREE plan lock, the revoke barrier in the same tx, and
 * the Cloudinary blob cleanup AFTER a successful commit (the FK cascade deletes the VisitResultPhoto
 * rows, so URLs not collected before the delete would be orphaned).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  createManualVisit_IO,
  deleteManualVisit_IO,
  MANUAL_VISIT_DEDUP_WINDOW_MS,
  updateVisitServiceNote_IO,
} from './visit-record.operations';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { cleanupCloudinaryAssets } from '@domain/gallery/operations/gallery-cloudinary-cleanup';

vi.mock('@domain/gallery/operations/gallery-cloudinary-cleanup', () => ({
  cleanupCloudinaryAssets: vi.fn(),
}));

const STYLIST_ACCOUNT_ID = 'acc_test_0000000000000001';
const CLIENT_USER_ID = 'usr_test_0000000000000001';
const VISIT_ID = 'vis_test_0000000000000001';
const ASSET_URL = 'https://res.cloudinary.com/test/image/upload/v1/visit-1.jpg';

type RawStub = Record<string, (...args: never[]) => unknown>;
const rawStub = (fn: () => unknown) => fn as unknown as RawStub;

const mockDeleteScenario = ({
  visitExists = true,
  pairActive = true,
  lockedPair = true,
  deletedCount = 1,
  photos = [] as { asset_url: string }[],
} = {}) => {
  const deleteMany = vi.fn(
    async (_args: { where: Record<string, unknown> }) => ({
      count: deletedCount,
    })
  );
  mockDb({
    visitRecord: {
      findFirst: vi.fn(async () =>
        visitExists
          ? {
              id: VISIT_ID,
              client_user_id: CLIENT_USER_ID,
              visit_date: new Date(),
            }
          : null
      ),
      deleteMany,
    },
    visitResultPhoto: {
      findMany: vi.fn(async () => photos),
    },
    clientStylistPair: {
      findFirst: vi.fn(async () => (pairActive ? { id: 'pair_1' } : null)),
      findUnique: vi.fn(async () => ({ salon_origin_account_id: null })),
    },
    // lockActivePair robi tx.$queryRaw (FOR UPDATE) — top-level stub, patrz
    // session-container-add-photo.test.ts (cast bridge nad per-model typem mockDb).
    $queryRaw: rawStub(async () => (lockedPair ? [{ id: 'pair_1' }] : [])),
  });
  return { deleteMany };
};

beforeEach(() => {
  vi.mocked(cleanupCloudinaryAssets).mockClear();
});

describe('deleteManualVisit_IO — destrukcyjna operacja karty klientki', () => {
  it('happy path: usuwa wpis MANUAL, filtruje po source i sprząta bloby Cloudinary', async () => {
    const { deleteMany } = mockDeleteScenario({
      photos: [{ asset_url: ASSET_URL }],
    });

    const result = await deleteManualVisit_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_pricing_plan: PricingPlanValue.PRO,
      visit_id: VISIT_ID,
    });

    expect(result.success).toBe(true);
    const where = deleteMany.mock.calls[0]?.[0]?.where;
    expect(where?.source).toBe('MANUAL');
    expect(where?.stylist_account_id).toBe(STYLIST_ACCOUNT_ID);
    expect(cleanupCloudinaryAssets).toHaveBeenCalledWith([ASSET_URL]);
  });

  it('obca stylistka: wizyta niewidoczna w jej scope → VISIT_NOT_FOUND, zero delete', async () => {
    const { deleteMany } = mockDeleteScenario({ visitExists: false });

    const result = await deleteManualVisit_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_pricing_plan: PricingPlanValue.PRO,
      visit_id: VISIT_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VISIT_NOT_FOUND');
    }
    expect(deleteMany).not.toHaveBeenCalled();
    expect(cleanupCloudinaryAssets).not.toHaveBeenCalled();
  });

  it('wpis SESSION: deleteMany z filtrem source=MANUAL trafia 0 wierszy → VISIT_NOT_FOUND (anty-oracle), bez cleanupu', async () => {
    mockDeleteScenario({ deletedCount: 0, photos: [{ asset_url: ASSET_URL }] });

    const result = await deleteManualVisit_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_pricing_plan: PricingPlanValue.PRO,
      visit_id: VISIT_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VISIT_NOT_FOUND');
    }
    expect(cleanupCloudinaryAssets).not.toHaveBeenCalled();
  });

  // This test used to encode the OPPOSITE expectation (FREE → CLIENT_CARD_PLAN_LOCKED,
  // zero IO) and pinned a real bug: after a downgrade to a plan without history, visits
  // with notes about a client became invisible AND undeletable. The rule is unambiguous
  // (see the DECISION in visit-common.operations.ts): the tier regulates VIEWING, not the
  // right to delete, and the stylist is the controller of this personal data.
  it('plan FREE: kasowanie PRZECHODZI — tier reguluje wgląd, nie prawo do usunięcia', async () => {
    const { deleteMany } = mockDeleteScenario({ deletedCount: 1 });

    const result = await deleteManualVisit_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_pricing_plan: PricingPlanValue.FREE,
      visit_id: VISIT_ID,
    });

    expect(result.success).toBe(true);
    expect(deleteMany).toHaveBeenCalled();
  });

  it('plan FREE: ścieżka oddająca TREŚĆ nadal zablokowana → CLIENT_CARD_PLAN_LOCKED', async () => {
    // Other half of the rule: the exemption covers ONLY operations that return no visit field. If it
    // also covered note editing (which echoes the full DTO), a write would become a reader of
    // tier-locked content.
    mockDeleteScenario();

    const result = await updateVisitServiceNote_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_pricing_plan: PricingPlanValue.FREE,
      visit_id: VISIT_ID,
      service_note: 'cokolwiek',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('CLIENT_CARD_PLAN_LOCKED');
    }
  });

  it('revoke-race: barrier-lock nie znajduje ACTIVE pary w tx → CLIENT_UNAUTHORIZED_ACCESS, zero delete', async () => {
    const { deleteMany } = mockDeleteScenario({ lockedPair: false });

    const result = await deleteManualVisit_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_pricing_plan: PricingPlanValue.PRO,
      visit_id: VISIT_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('CLIENT_UNAUTHORIZED_ACCESS');
    }
    expect(deleteMany).not.toHaveBeenCalled();
    expect(cleanupCloudinaryAssets).not.toHaveBeenCalled();
  });

  it('wizyta bez zdjęć: sukces bez wywoływania cleanupu (zero pustych wywołań Cloudinary)', async () => {
    mockDeleteScenario({ photos: [] });

    const result = await deleteManualVisit_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_pricing_plan: PricingPlanValue.PRO_PLUS,
      visit_id: VISIT_ID,
    });

    expect(result.success).toBe(true);
    expect(cleanupCloudinaryAssets).not.toHaveBeenCalled();
  });
});

describe('createManualVisit_IO — dedup podwójnego wysłania', () => {
  const VISIT_DATE = '2026-09-20';
  const existingRow = {
    id: 'vis_existing',
    client_user_id: CLIENT_USER_ID,
    stylist_account_id: STYLIST_ACCOUNT_ID,
    visit_date: new Date(VISIT_DATE),
    service_note: 'hybryda',
    source: 'MANUAL',
    session_id: null,
    created_at: new Date(),
    result_photos: [],
  };

  const mockCreateScenario = (duplicate: typeof existingRow | null) => {
    const findFirst = vi.fn(
      async (_args: { where: Record<string, unknown> }) => duplicate
    );
    const create = vi.fn(async () => ({ ...existingRow, id: 'vis_new' }));
    mockDb({
      visitRecord: { findFirst, create, count: vi.fn(async () => 0) },
      clientStylistPair: {
        findFirst: vi.fn(async () => ({ id: 'pair_1' })),
        findUnique: vi.fn(async () => ({ salon_origin_account_id: null })),
      },
      $queryRaw: rawStub(async () => [{ id: 'pair_1' }]),
    });
    return { findFirst, create };
  };

  const createArgs = {
    stylist_account_id: STYLIST_ACCOUNT_ID,
    client_user_id: CLIENT_USER_ID,
    stylist_pricing_plan: PricingPlanValue.PRO,
    visit_date: VISIT_DATE,
    service_note: '  hybryda  ',
  };

  it('ta sama wizyta w oknie → oddaje istniejący wpis, bez drugiego insertu', async () => {
    const { findFirst, create } = mockCreateScenario(existingRow);

    const result = await createManualVisit_IO(createArgs);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('vis_existing');
    }
    expect(create).not.toHaveBeenCalled();
    const where = findFirst.mock.calls[0]?.[0]?.where;
    expect(where).toMatchObject({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      source: 'MANUAL',
      visit_date: new Date(VISIT_DATE),
      // the note is compared after the same normalization as the write
      service_note: 'hybryda',
    });
    const since = (where?.created_at as { gte: Date }).gte.getTime();
    expect(Date.now() - since).toBeGreaterThanOrEqual(
      MANUAL_VISIT_DEDUP_WINDOW_MS - 50
    );
    expect(Date.now() - since).toBeLessThanOrEqual(
      MANUAL_VISIT_DEDUP_WINDOW_MS + 1000
    );
  });

  it('poza oknem (brak bliźniaka) → nowy wpis', async () => {
    const { create } = mockCreateScenario(null);

    const result = await createManualVisit_IO(createArgs);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('vis_new');
    }
    expect(create).toHaveBeenCalledTimes(1);
  });
});
