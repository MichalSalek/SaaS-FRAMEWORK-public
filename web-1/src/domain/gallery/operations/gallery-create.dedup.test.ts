/**
 * createGalleryRecord_IO — idempotencja po `public_id` (2026-09-25).
 *
 * Ten sam plik w chmurze na tym samym koncie = ta sama praca: powtórzone wysłanie
 * oddaje istniejący rekord (bez insertu, bez podbicia licznika, bez sprzątania
 * pliku), a nowy plik tworzy rekord normalnie. Wydzielone z
 * gallery-create.operation.test.ts (limit długości pliku).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  assetOwnershipStubs,
  mockDb,
} from '../../../test-utils/mockApiHandler';
import { createGalleryRecord_IO } from './gallery-create.operation';
import { cleanupCloudinaryAsset } from './gallery-cloudinary-cleanup';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';

vi.mock('./gallery-cloudinary-cleanup', () => ({
  cleanupCloudinaryAsset: vi.fn(),
  cleanupCloudinaryAssets: vi.fn(),
}));

const ACCOUNT_ID = 'acc_test_0000000000000001';
const OP_ID = 'op_test_0000000000000001';

type RawStub = Record<string, (...args: never[]) => unknown>;
const rawStub = (fn: unknown): RawStub => fn as RawStub;

const makeArgs = (asset_url: string) => ({
  props: {
    created_by_account_id: ACCOUNT_ID,
    asset_url,
    color_ids: ['color_1'],
    trait_ids: ['trait_1'],
    nail_length: NAIL_LENGTHS.MEDIUM,
  },
  id: OP_ID,
});

describe('createGalleryRecord_IO — idempotencja po public_id (podwójne wysłanie)', () => {
  const STORED_URL =
    'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1/nailfolio/same-photo.jpg';

  const mockDedupScenario = (
    existing: { gallery_record_id: string } | null
  ) => {
    const ownership = assetOwnershipStubs(null);
    // Ta sama metoda obsługuje bramkę własności (created_by_account_id: {not})
    // i dedup (created_by_account_id: <to konto>) — rozróżniamy po `where`.
    const findFirst = vi.fn(
      async (args: { where: { created_by_account_id: unknown } }) =>
        typeof args.where.created_by_account_id === 'string' ? existing : null
    );
    const count = vi.fn(async () => 0);
    const create = vi.fn(async (_arg: unknown) => ({
      gallery_record_id: 'gr_new_000000000000001',
      created_by_account_id: ACCOUNT_ID,
      asset_url: STORED_URL,
    }));
    const queryRaw = vi.fn(async (..._args: unknown[]) => [{ locked: '' }]);
    const executeRaw = vi.fn(async () => 1);
    mockDb({
      ...ownership,
      stylistAccount: {
        ...ownership.stylistAccount,
        findUnique: vi.fn(async () => ({
          pricing_plan: PricingPlanValue.FREE,
        })),
      },
      color: { findMany: vi.fn(async () => [{ id: 'color_1' }]) },
      trait: { findMany: vi.fn(async () => [{ id: 'trait_1' }]) },
      galleryRecord: { ...ownership.galleryRecord, findFirst, count, create },
      $queryRaw: rawStub(queryRaw),
      $executeRaw: rawStub(executeRaw),
    });
    return { findFirst, count, create, queryRaw, executeRaw };
  };

  it('ten sam plik na tym samym koncie → istniejący rekord, bez insertu, licznika i sprzątania', async () => {
    vi.mocked(cleanupCloudinaryAsset).mockClear();
    const { findFirst, count, create, queryRaw, executeRaw } =
      mockDedupScenario({ gallery_record_id: 'gr_existing_0000000001' });

    const result = await createGalleryRecord_IO(makeArgs(STORED_URL));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gallery_record_id).toBe('gr_existing_0000000001');
    }
    expect(create).not.toHaveBeenCalled();
    // Dedup stoi PRZED bramką limitu — powtórka przy pełnym limicie nie dostaje 403.
    expect(count).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
    expect(cleanupCloudinaryAsset).not.toHaveBeenCalled();
    // Blokada doradcza na (konto, public_id) serializuje równoległe bliźniaki.
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(queryRaw.mock.calls[0]).toContain(
      `gallery-create:${ACCOUNT_ID}:nailfolio/same-photo`
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          created_by_account_id: ACCOUNT_ID,
          public_id: 'nailfolio/same-photo',
        },
      })
    );
  });

  it('nowy plik (brak rekordu z tym public_id) → normalny insert', async () => {
    const { create } = mockDedupScenario(null);

    const result = await createGalleryRecord_IO(makeArgs(STORED_URL));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gallery_record_id).toBe('gr_new_000000000000001');
    }
    expect(create).toHaveBeenCalledTimes(1);
  });
});
