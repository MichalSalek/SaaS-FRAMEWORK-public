/**
 * deleteAssetFromVendor_IO. Ownership is exact public_id equality on the stored
 * record; a substring match does not authorize destroy, and destroy uses the
 * stored URL, not the client string. The candidate query is scoped to the
 * stylist and the contains pre-filter is LIKE-escaped. Missing and not-owned
 * both return GALLERY_RECORD_NOT_FOUND. A transient destroy is retried; three
 * failures become EXTERNAL_SERVICE_ERROR.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';

const { destroyMock } = vi.hoisted(() => ({
  destroyMock: vi.fn(async () => ({ result: 'ok' })),
}));

vi.mock('@app/cloudinary/cloudinary.adapter', () => ({
  cloudinary: {
    uploader: { destroy: destroyMock },
    api: { delete_resources: vi.fn(async () => ({ deleted: {} })) },
  },
}));

import { deleteAssetFromVendor_IO } from './gallery-asset.operations';

const USER_ID = 'usr_test_0000000000000001';
const ACCOUNT_ID = 'acc_test_0000000000000001';
const PUBLIC_ID = 'nailfolio/abc123';
const STORED_URL = `https://res.cloudinary.com/test/image/upload/v1700000000/${PUBLIC_ID}.jpg`;

const baseArgs = {
  assetID: PUBLIC_ID,
  userID: USER_ID,
  stylistAccountId: ACCOUNT_ID,
};

const mockCandidates = (
  candidates: Array<{ gallery_record_id: string; asset_url: string }>
) => {
  const findMany = vi.fn(async (_arg: unknown) => candidates);
  mockDb({
    galleryRecord: { findMany },
    user: { findMany: async () => [] },
    stylistAccount: { findMany: async () => [] },
  });
  return { findMany };
};

describe('deleteAssetFromVendor_IO — VERIFY == ACT vendor delete', () => {
  it('exact public_id match on an owned record → destroy on the STORED-derived public_id', async () => {
    const { findMany } = mockCandidates([
      { gallery_record_id: 'gr_1', asset_url: STORED_URL },
    ]);

    const result = await deleteAssetFromVendor_IO(baseArgs);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ deleted: true });
    }
    expect(destroyMock).toHaveBeenCalledTimes(1);
    expect(destroyMock).toHaveBeenCalledWith(PUBLIC_ID);

    // Candidate query is OWNER-scoped — never a global asset lookup.
    const whereArg = findMany.mock.calls[0]?.[0] as {
      where: {
        created_by_account_id: string;
        asset_url: { contains: string };
      };
    };
    expect(whereArg.where.created_by_account_id).toBe(ACCOUNT_ID);
  });

  it('full Cloudinary URL input is normalized to the bare public_id before compare', async () => {
    mockCandidates([{ gallery_record_id: 'gr_1', asset_url: STORED_URL }]);

    const result = await deleteAssetFromVendor_IO({
      ...baseArgs,
      assetID: STORED_URL,
    });

    expect(result.success).toBe(true);
    expect(destroyMock).toHaveBeenCalledWith(PUBLIC_ID);
  });

  it('substring-but-not-exact match → GALLERY_RECORD_NOT_FOUND and destroy NEVER runs (no verify/act decoupling)', async () => {
    // The contains pre-filter WOULD return this candidate ('nailfolio/abc' is a
    // substring of the stored URL), but exact public_id equality fails.
    mockCandidates([{ gallery_record_id: 'gr_1', asset_url: STORED_URL }]);

    const result = await deleteAssetFromVendor_IO({
      ...baseArgs,
      assetID: 'nailfolio/abc',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('GALLERY_RECORD_NOT_FOUND');
    }
    expect(destroyMock).not.toHaveBeenCalled();
  });

  it('LIKE metacharacters in the public_id are escaped in the contains pre-filter (raw id still used for equality)', async () => {
    const underscoreId = 'nailfolio/ab_c1';
    const underscoreUrl = `https://res.cloudinary.com/test/image/upload/v1700000000/${underscoreId}.jpg`;
    const { findMany } = mockCandidates([
      { gallery_record_id: 'gr_1', asset_url: underscoreUrl },
    ]);

    const result = await deleteAssetFromVendor_IO({
      ...baseArgs,
      assetID: underscoreId,
    });

    expect(result.success).toBe(true);
    const whereArg = findMany.mock.calls[0]?.[0] as {
      where: { asset_url: { contains: string } };
    };
    // `_` escaped for ILIKE — otherwise a single-char wildcard.
    expect(whereArg.where.asset_url.contains).toBe('nailfolio/ab\\_c1');
    // Equality verify + destroy act on the UN-escaped id.
    expect(destroyMock).toHaveBeenCalledWith(underscoreId);
  });

  it('no owned candidate → GALLERY_RECORD_NOT_FOUND (existence mask), no destroy', async () => {
    mockCandidates([]);

    const result = await deleteAssetFromVendor_IO(baseArgs);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('GALLERY_RECORD_NOT_FOUND');
    }
    expect(destroyMock).not.toHaveBeenCalled();
  });

  it('ownership query throws → DATABASE_ERROR, no destroy', async () => {
    mockDb({
      galleryRecord: {
        findMany: vi.fn(async () => {
          throw new Error('connection reset');
        }),
      },
    });

    const result = await deleteAssetFromVendor_IO(baseArgs);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
    expect(destroyMock).not.toHaveBeenCalled();
  });

  it('transient destroy failure → retried, succeeds on 2nd attempt', async () => {
    vi.useFakeTimers();
    try {
      mockCandidates([{ gallery_record_id: 'gr_1', asset_url: STORED_URL }]);
      destroyMock
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce({ result: 'ok' });

      const pending = deleteAssetFromVendor_IO(baseArgs);
      await vi.runAllTimersAsync(); // flush the 500ms backoff sleep
      const result = await pending;

      expect(result.success).toBe(true);
      expect(destroyMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroy fails all 3 attempts → EXTERNAL_SERVICE_ERROR (CLOUDINARY)', async () => {
    vi.useFakeTimers();
    try {
      mockCandidates([{ gallery_record_id: 'gr_1', asset_url: STORED_URL }]);
      destroyMock.mockRejectedValue(new Error('Cloudinary 5xx'));

      const pending = deleteAssetFromVendor_IO(baseArgs);
      await vi.runAllTimersAsync(); // flush 500ms + 1000ms backoff sleeps
      const result = await pending;

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('EXTERNAL_SERVICE_ERROR');
        if (result.error.type === 'EXTERNAL_SERVICE_ERROR') {
          expect(result.error.service).toBe('CLOUDINARY');
        }
      }
      expect(destroyMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
