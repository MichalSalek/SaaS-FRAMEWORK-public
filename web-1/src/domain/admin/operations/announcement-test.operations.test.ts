import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { makeStylistCurrentUser } from '../../../test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { dispatchPushForNotification_IO } from '@domain/notifications/push/push-dispatch.service';
import { testAnnouncementNotification_IO } from './announcement-test.operations';
import { pushAnnouncementNotification_IO } from './announcement-notification.operations';

vi.mock('@domain/notifications/push/push-dispatch.service', () => ({
  dispatchPushForNotification_IO: vi.fn(async () => ({
    sent: 0,
    failed: 0,
    gone: 0,
    skipped: 'no-devices' as const,
  })),
}));

const admin = makeStylistCurrentUser({
  user: { role_id: SystemRoleId.MASTER_ADMIN },
});
const translations = { en: { title: 'News', message: 'Read [more](/blog/a)' } };
const announcement = {
  id: 'news',
  translations,
  title: 'News',
  message: 'Read more',
  notification_sent_at: null,
};
const notification = {
  id: 'test-bell',
  user_id: admin.id,
  recipient_role: null,
  type: 'SYSTEM_ANNOUNCEMENT' as const,
  dedup_key: 'ANNOUNCEMENT_TEST:news:en',
  actor_user_id: null,
  actor_name: null,
  target_path: '/app/notifications',
  created_at: new Date(),
  read_at: null,
};

beforeEach(() => vi.mocked(dispatchPushForNotification_IO).mockClear());

describe('admin-only announcement rehearsal', () => {
  it('rejects recipient injection at the shared contract boundary', () => {
    expect(
      ADMIN_CONTRACTS.ADMIN_TEST_ANNOUNCEMENT_NOTIFICATION.body.safeParse({
        id: 'news',
        locale: 'en',
        user_id: 'someone-else',
      }).success
    ).toBe(false);
  });

  it('targets only the session administrator and leaves the broadcast marker untouched', async () => {
    const upsert = vi.fn(async (..._args: unknown[]) => notification);
    const update = vi.fn();
    const findMany = vi.fn();
    mockDb({
      announcement: { findUnique: async () => announcement, update },
      notification: { upsert },
      user: { findMany },
    });
    const result = await testAnnouncementNotification_IO({
      id: 'news',
      locale: 'en',
      currentUser: admin,
    });
    expect(result).toEqual({
      success: true,
      data: {
        notification_id: 'test-bell',
        push: { sent: 0, failed: 0, gone: 0, skipped: 'no-devices' },
      },
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          user_id_dedup_key: {
            user_id: admin.id,
            dedup_key: 'ANNOUNCEMENT_TEST:news:en',
          },
        },
        create: expect.objectContaining({
          user_id: admin.id,
          announcement_id: 'news',
          recipient_role: null,
        }),
        update: expect.objectContaining({
          read_at: null,
          created_at: expect.any(Date),
        }),
      })
    );
    expect(dispatchPushForNotification_IO).toHaveBeenCalledWith({
      userId: admin.id,
      notification,
      copy: { title: 'News', body: 'Read more' },
    });
    expect(update).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('allows rehearsing an already sent announcement without distributing it again', async () => {
    const upsert = vi.fn(async () => notification);
    mockDb({
      announcement: {
        findUnique: async () => ({
          ...announcement,
          notification_sent_at: new Date(),
        }),
      },
      notification: { upsert },
    });
    expect(
      (
        await testAnnouncementNotification_IO({
          id: 'news',
          locale: 'en',
          currentUser: admin,
        })
      ).success
    ).toBe(true);
    expect(upsert).toHaveBeenCalledOnce();
  });

  it('does not silently borrow another language for a test', async () => {
    const upsert = vi.fn();
    mockDb({
      announcement: { findUnique: async () => announcement },
      notification: { upsert },
    });
    expect(
      (
        await testAnnouncementNotification_IO({
          id: 'news',
          locale: 'pl',
          currentUser: admin,
        })
      ).success
    ).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
    expect(dispatchPushForNotification_IO).not.toHaveBeenCalled();
  });

  it('denies a non-admin before reading the announcement', async () => {
    const findUnique = vi.fn();
    mockDb({ announcement: { findUnique } });
    expect(
      (
        await testAnnouncementNotification_IO({
          id: 'news',
          locale: 'en',
          currentUser: makeStylistCurrentUser(),
        })
      ).success
    ).toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('never hands rehearsal bells to the real broadcast push pass', async () => {
    const findMany = vi.fn(async (..._args: unknown[]) => []);
    mockDb({ notification: { findMany } });
    await pushAnnouncementNotification_IO({
      id: 'news',
      created: true,
      translations,
      sentAt: new Date().toISOString(),
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { announcement_id: 'news', dedup_key: 'ANNOUNCEMENT:news' },
      })
    );
  });
});
