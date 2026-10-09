/**
 * Gallery-detail unit tests — getGalleryRecordByID_IO.
 *
 * Locks in the per-record visibility contract (RBAC=LOGGED_USER endpoint, so
 * these guards are the ONLY thing between any logged user and a hidden asset):
 *
 *  - moderation mask: is_hidden record → GALLERY_RECORD_NOT_FOUND for non-owners,
 *    but the OWNER still sees their own hidden record (user-level bypass);
 *  - visibility cascade: inactive account_status OR soft-deleted user
 *    (is_active=false) → NOT_FOUND for non-owners, owner bypass holds;
 *  - is_pinned semantics: owner → record's own flag; non-owner → is_favorited;
 *  - response payload never leaks the guard columns (created_by_user_id,
 *    account_status) — stylist_info is the public subset only;
 *  - favorited_by sub-query is scoped to the CURRENT user.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { getGalleryRecordByID_IO } from './gallery-detail.query';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';
import {
  AccountStatusValue,
  PairingStatusValue,
} from '@kernel/models/db_models.generated.dto';

const RECORD_ID = 'gr_test_0000000000000001';
const OWNER_USER_ID = 'usr_owner_000000000001';
const VIEWER_USER_ID = 'usr_viewer_00000000001';
const ACCOUNT_ID = 'acc_test_0000000000000001';

const makeRecord = ({
  isHidden = false,
  isPinned = true,
  accountStatus = AccountStatusValue.ACTIVE as string,
  userActive = true,
  favoritedBy = [] as Array<{ id: string }>,
} = {}) => ({
  gallery_record_id: RECORD_ID,
  asset_url: 'https://res.cloudinary.com/test/image/upload/v1/photo.jpg',
  nail_length: NAIL_LENGTHS.MEDIUM,
  is_hidden: isHidden,
  is_pinned: isPinned,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  colors: [],
  traits: [],
  created_by_account: {
    account_id: ACCOUNT_ID,
    display_name: 'Test Salon',
    business_name: null,
    address_city: 'Warszawa',
    created_by_user_id: OWNER_USER_ID,
    account_status: accountStatus,
    created_by_user: { is_active: userActive },
  },
  favorited_by: favoritedBy,
});

const mockRecord = (record: ReturnType<typeof makeRecord> | null) => {
  const findUnique = vi.fn(async (_arg: unknown) => record);
  mockDb({ galleryRecord: { findUnique } });
  return { findUnique };
};

describe('getGalleryRecordByID_IO — visibility guards + pinned semantics', () => {
  it('record not found → GALLERY_RECORD_NOT_FOUND', async () => {
    mockRecord(null);

    const result = await getGalleryRecordByID_IO({
      gallery_record_id: RECORD_ID,
      id: VIEWER_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('GALLERY_RECORD_NOT_FOUND');
    }
  });

  it('hidden record + non-owner → NOT_FOUND (moderation bypass blocked, no asset_url leak)', async () => {
    mockRecord(makeRecord({ isHidden: true }));

    const result = await getGalleryRecordByID_IO({
      gallery_record_id: RECORD_ID,
      id: VIEWER_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('GALLERY_RECORD_NOT_FOUND');
    }
  });

  it('hidden record + OWNER → success (owner sees their own hidden record)', async () => {
    mockRecord(makeRecord({ isHidden: true }));

    const result = await getGalleryRecordByID_IO({
      gallery_record_id: RECORD_ID,
      id: OWNER_USER_ID,
    });

    expect(result.success).toBe(true);
  });

  it('inactive account (EXPIRED) + non-owner → NOT_FOUND (visibility cascade)', async () => {
    mockRecord(makeRecord({ accountStatus: AccountStatusValue.EXPIRED }));

    const result = await getGalleryRecordByID_IO({
      gallery_record_id: RECORD_ID,
      id: VIEWER_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('GALLERY_RECORD_NOT_FOUND');
    }
  });

  it('soft-deleted owner user (is_active=false) + non-owner → NOT_FOUND', async () => {
    mockRecord(makeRecord({ userActive: false }));

    const result = await getGalleryRecordByID_IO({
      gallery_record_id: RECORD_ID,
      id: VIEWER_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('GALLERY_RECORD_NOT_FOUND');
    }
  });

  it('inactive account + OWNER → success (owner bypass, sees only their own)', async () => {
    mockRecord(makeRecord({ accountStatus: AccountStatusValue.NOT_ACTIVE }));

    const result = await getGalleryRecordByID_IO({
      gallery_record_id: RECORD_ID,
      id: OWNER_USER_ID,
    });

    expect(result.success).toBe(true);
  });

  it('owner viewer: is_pinned = the RECORD flag; payload exposes only the public stylist_info subset', async () => {
    const { findUnique } = mockRecord(
      makeRecord({ isPinned: true, favoritedBy: [] })
    );

    const result = await getGalleryRecordByID_IO({
      gallery_record_id: RECORD_ID,
      id: OWNER_USER_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_pinned).toBe(true);
      expect(result.data.is_favorited).toBe(false);
      // Guard columns selected for the server-side checks must NOT leak.
      expect(result.data.stylist_info).toEqual({
        account_id: ACCOUNT_ID,
        display_name: 'Test Salon',
        business_name: null,
        address_city: 'Warszawa',
      });
      expect(Object.keys(result.data.stylist_info)).not.toContain(
        'created_by_user_id'
      );
    }
    // favorited_by sub-query scoped to the CURRENT user (not a global count).
    const arg = findUnique.mock.calls[0]?.[0] as {
      include: { favorited_by: { where: { client_user_id: string } } };
    };
    expect(arg.include.favorited_by.where.client_user_id).toBe(OWNER_USER_ID);
  });

  it('non-owner viewer: is_pinned mirrors is_favorited (their own favorite state)', async () => {
    mockRecord(makeRecord({ isPinned: true, favoritedBy: [{ id: 'fav_1' }] }));

    const result = await getGalleryRecordByID_IO({
      gallery_record_id: RECORD_ID,
      id: VIEWER_USER_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_favorited).toBe(true);
      expect(result.data.is_pinned).toBe(true); // = favorited, NOT the record flag
    }
  });

  it('non-owner viewer without favorite: is_pinned=false even though the record IS pinned', async () => {
    mockRecord(makeRecord({ isPinned: true, favoritedBy: [] }));

    const result = await getGalleryRecordByID_IO({
      gallery_record_id: RECORD_ID,
      id: VIEWER_USER_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_favorited).toBe(false);
      expect(result.data.is_pinned).toBe(false);
    }
  });

  it('DB throw → DATABASE_ERROR', async () => {
    mockDb({
      galleryRecord: {
        findUnique: vi.fn(async () => {
          throw new Error('connection reset');
        }),
      },
    });

    const result = await getGalleryRecordByID_IO({
      gallery_record_id: RECORD_ID,
      id: VIEWER_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
  });
});

/**
 * Pairing-gate on NON-PINNED content (security-critical, non-owner branch).
 *
 * DOMAIN_SSOT §4.1/§4.2: only PINNED photos are public; the rest of a stylist's
 * gallery is pairing-gated (visible only after an ACTIVE ClientStylistPair).
 * Endpoint RBAC=LOGGED_USER + findUnique-by-ID means that without this gate ANY
 * logged, unpaired stranger who has/guesses a non-pinned record ID would get a 200
 * with asset_url + stylist_info (IDOR + enumeration). These tests exercise the
 * clientStylistPair.findFirst branch that the is_pinned:true tests above never enter.
 */
describe('getGalleryRecordByID_IO — pairing gate on non-pinned content', () => {
  const mockRecordAndPair = (
    record: ReturnType<typeof makeRecord>,
    activePair: { id: string } | null
  ) => {
    const findUnique = vi.fn(async (_arg: unknown) => record);
    const findFirst = vi.fn(async (_arg: unknown) => activePair);
    mockDb({
      galleryRecord: { findUnique },
      clientStylistPair: { findFirst },
    });
    return { findUnique, findFirst };
  };

  it('non-owner + not pinned + NO active pair → GALLERY_RECORD_NOT_FOUND (IDOR/enumeration blocked)', async () => {
    const { findFirst } = mockRecordAndPair(
      makeRecord({ isPinned: false }),
      null
    );

    const result = await getGalleryRecordByID_IO({
      gallery_record_id: RECORD_ID,
      id: VIEWER_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success && result.error.type === 'GALLERY_RECORD_NOT_FOUND') {
      expect(result.error.recordId).toBe(RECORD_ID);
    } else {
      throw new Error('expected GALLERY_RECORD_NOT_FOUND');
    }
    // Pairing lookup is scoped to the CURRENT user + this record's stylist account,
    // and only an ACTIVE pair counts.
    const arg = findFirst.mock.calls[0]?.[0] as {
      where: {
        client_user_id: string;
        stylist_account_id: string;
        status: string;
      };
    };
    expect(arg.where.client_user_id).toBe(VIEWER_USER_ID);
    expect(arg.where.stylist_account_id).toBe(ACCOUNT_ID);
    expect(arg.where.status).toBe(PairingStatusValue.ACTIVE);
  });

  it('non-owner + not pinned + ACTIVE pair → success (paired client sees gated content)', async () => {
    const { findFirst } = mockRecordAndPair(makeRecord({ isPinned: false }), {
      id: 'csp_pair_00000000001',
    });

    const result = await getGalleryRecordByID_IO({
      gallery_record_id: RECORD_ID,
      id: VIEWER_USER_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gallery_record.gallery_record_id).toBe(RECORD_ID);
      // Non-owner + not favorited → is_pinned mirrors is_favorited (false).
      expect(result.data.is_favorited).toBe(false);
      expect(result.data.is_pinned).toBe(false);
    }
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('owner + not pinned → success WITHOUT any pairing lookup (owner bypass)', async () => {
    const { findFirst } = mockRecordAndPair(
      makeRecord({ isPinned: false }),
      null
    );

    const result = await getGalleryRecordByID_IO({
      gallery_record_id: RECORD_ID,
      id: OWNER_USER_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // Owner → is_pinned reflects the RECORD flag (false here), not favorite state.
      expect(result.data.is_pinned).toBe(false);
    }
    // Owner bypass must short-circuit BEFORE the pairing table is queried.
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('non-owner + PINNED → success without any pairing lookup (public pinned content)', async () => {
    // Confirms the is_pinned:true fast-path: pinned records are public, so the
    // pairing gate is skipped entirely even for a stranger.
    const { findFirst } = mockRecordAndPair(
      makeRecord({ isPinned: true }),
      null
    );

    const result = await getGalleryRecordByID_IO({
      gallery_record_id: RECORD_ID,
      id: VIEWER_USER_ID,
    });

    expect(result.success).toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
