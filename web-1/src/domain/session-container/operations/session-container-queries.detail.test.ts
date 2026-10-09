/**
 * SessionContainer DETAIL-QUERY unit tests — loadSessionDetail_IO +
 * getSessionContainerById_IO (domain-unit; sibling file
 * session-container-queries.operations.test.ts covers getMySessionContainers_IO —
 * split to stay under ESLint max-lines).
 *
 * s22 priority (commit ee9987ff): the read-side is_hidden mask — a moderation-hidden
 * gallery record hydrates as gallery_record_data === null for the client viewer
 * (backstop for hide-AFTER-add), the stylist-owner bypasses, and the raw `is_hidden`
 * flag NEVER leaks into the DTO for either viewer. Plus get-by-id authorization
 * (stranger / client-private DRAFT / SCCAP-3 terminal-never-shared → the SAME
 * NOT_AUTHORIZED) with end-to-end viewer-side wiring into loadSessionDetail.
 */

import { describe, it, expect } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  getSessionContainerById_IO,
  loadSessionDetail_IO,
} from './session-container-queries.operations';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';

const SESSION_ID = 'sess_test_000000000000001';
const CLIENT_ACCOUNT_ID = 'cli_test_0000000000000001';
const STYLIST_ACCOUNT_ID = 'acc_stylist_0000000000001';
const OTHER_STYLIST_ID = 'acc_stylist_other_0000001';
const ACTOR_USER_ID = 'usr_actor_000000000000001';

const makeRow = (overrides: Record<string, unknown> = {}) => ({
  id: SESSION_ID,
  client_account_id: CLIENT_ACCOUNT_ID,
  stylist_account_id: STYLIST_ACCOUNT_ID,
  name: null,
  lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
  stylist_note: null,
  client_note: null,
  shared_at: new Date('2026-01-01T00:00:00.000Z'),
  expires_at: new Date(Date.now() + 60 * 60 * 1000),
  closed_at: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
  _count: { photos: 1 },
  ...overrides,
});

const makePhotoRow = (
  id: string,
  galleryRecordId: string,
  position: number
) => ({
  id,
  session_id: SESSION_ID,
  gallery_record_id: galleryRecordId,
  position,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
});

const makeRecordRow = (id: string, isHidden: boolean) => ({
  gallery_record_id: id,
  asset_url: `https://cdn.test/${id}.jpg`,
  nail_length: 'MEDIUM',
  is_pinned: false,
  created_by_account_id: STYLIST_ACCOUNT_ID,
  is_hidden: isHidden,
});

describe('loadSessionDetail_IO — s22 is_hidden read mask', () => {
  const installDetailDb = () => {
    mockDb({
      sessionContainer: { findUnique: async () => makeRow() },
      sessionContainerPhoto: {
        findMany: async () => [
          makePhotoRow('scp_1', 'gr_hidden_000000000000001', 0),
          makePhotoRow('scp_2', 'gr_visible_00000000000001', 1),
        ],
        count: async () => 250,
      },
      galleryRecord: {
        findMany: async () => [
          makeRecordRow('gr_hidden_000000000000001', true),
          makeRecordRow('gr_visible_00000000000001', false),
        ],
      },
    });
  };

  it('unknown session → NOT_FOUND', async () => {
    mockDb({
      sessionContainer: { findUnique: async () => null },
      sessionContainerPhoto: {
        findMany: async () => [],
        count: async () => 0,
      },
    });

    const result = await loadSessionDetail_IO(SESSION_ID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_NOT_FOUND');
    }
  });

  it('default (client) viewer: hidden record masked to null; visible record hydrated WITHOUT the is_hidden flag; photoCount independent of the photos cap', async () => {
    installDetailDb();

    const result = await loadSessionDetail_IO(SESSION_ID);

    expect(result.success).toBe(true);
    if (result.success) {
      const [hidden, visible] = result.data.photos;
      // Moderation-hidden → reference stays (position slot) but content is gone.
      expect(hidden?.galleryRecord).toBeUndefined();
      expect(visible?.galleryRecord?.asset_url).toBe(
        'https://cdn.test/gr_visible_00000000000001.jpg'
      );
      // The raw moderation flag must NOT leak into the DTO.
      if (visible?.galleryRecord) {
        expect('is_hidden' in visible.galleryRecord).toBe(false);
      }
      // Independent count (take:200 cap upstream must not shrink the reported total).
      expect(result.data.photoCount).toBe(250);
    }
  });

  it("viewer 'stylist' (owner of every session record) BYPASSES the hidden mask — still without the raw flag", async () => {
    installDetailDb();

    const result = await loadSessionDetail_IO(SESSION_ID, 'stylist');

    expect(result.success).toBe(true);
    if (result.success) {
      const [hidden] = result.data.photos;
      expect(hidden?.galleryRecord?.asset_url).toBe(
        'https://cdn.test/gr_hidden_000000000000001.jpg'
      );
      if (hidden?.galleryRecord) {
        expect('is_hidden' in hidden.galleryRecord).toBe(false);
      }
    }
  });

  it('photo whose record vanished entirely → gallery_record_data null (no throw)', async () => {
    mockDb({
      sessionContainer: { findUnique: async () => makeRow() },
      sessionContainerPhoto: {
        findMany: async () => [
          makePhotoRow('scp_1', 'gr_gone_00000000000000001', 0),
        ],
        count: async () => 1,
      },
      galleryRecord: { findMany: async () => [] },
    });

    const result = await loadSessionDetail_IO(SESSION_ID);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.photos[0]?.galleryRecord).toBeUndefined();
    }
  });
});

describe('getSessionContainerById_IO — authorization + viewer wiring', () => {
  it('unknown session → NOT_FOUND', async () => {
    mockDb({ sessionContainer: { findUnique: async () => null } });

    const result = await getSessionContainerById_IO({
      session_id: SESSION_ID,
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: undefined,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_NOT_FOUND');
    }
  });

  it('caller neither owner nor assigned stylist → NOT_AUTHORIZED', async () => {
    mockDb({ sessionContainer: { findUnique: async () => makeRow() } });

    const result = await getSessionContainerById_IO({
      session_id: SESSION_ID,
      client_account_id: 'cli_other_000000000000001',
      stylist_account_id: OTHER_STYLIST_ID,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_NOT_AUTHORIZED');
    }
  });

  it('assigned stylist may NOT read a client-private DRAFT → NOT_AUTHORIZED', async () => {
    mockDb({
      sessionContainer: {
        findUnique: async () =>
          makeRow({
            lifecycle_state: SessionContainerLifecycleStateValue.DRAFT,
            shared_at: null,
            expires_at: null,
          }),
      },
    });

    const result = await getSessionContainerById_IO({
      session_id: SESSION_ID,
      client_account_id: undefined,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_NOT_AUTHORIZED');
    }
  });

  it('SCCAP-3 terminal-never-shared (CLOSED, shared_at=null) → NOT_AUTHORIZED for the assigned stylist', async () => {
    mockDb({
      sessionContainer: {
        findUnique: async () =>
          makeRow({
            lifecycle_state: SessionContainerLifecycleStateValue.CLOSED,
            shared_at: null,
            closed_at: new Date('2026-01-02T00:00:00.000Z'),
          }),
      },
    });

    const result = await getSessionContainerById_IO({
      session_id: SESSION_ID,
      client_account_id: undefined,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_NOT_AUTHORIZED');
    }
  });

  it('assigned stylist on a SHARED session → success with stylistNote REVEALED', async () => {
    mockDb({
      sessionContainer: {
        findUnique: async () => makeRow({ stylist_note: 'moja notka' }),
      },
      sessionContainerPhoto: {
        findMany: async () => [],
        count: async () => 0,
      },
    });

    const result = await getSessionContainerById_IO({
      session_id: SESSION_ID,
      client_account_id: undefined,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stylistNote).toBe('moja notka');
    }
  });

  it('owning client → success with stylistNote MASKED and hidden records masked (client viewer end-to-end)', async () => {
    mockDb({
      sessionContainer: {
        findUnique: async () => makeRow({ stylist_note: 'sekret' }),
      },
      sessionContainerPhoto: {
        findMany: async () => [
          makePhotoRow('scp_1', 'gr_hidden_000000000000001', 0),
        ],
        count: async () => 1,
      },
      galleryRecord: {
        findMany: async () => [
          makeRecordRow('gr_hidden_000000000000001', true),
        ],
      },
    });

    const result = await getSessionContainerById_IO({
      session_id: SESSION_ID,
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: undefined,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stylistNote).toBeNull();
      expect(result.data.photos[0]?.galleryRecord).toBeUndefined();
    }
  });
});
