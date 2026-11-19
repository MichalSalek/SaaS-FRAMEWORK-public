import { describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { makeStylistCurrentUser } from '../../../test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { sendAnnouncementNotification_IO } from './announcement-notification.operations';
import { batchResolveLocales } from '@app/email-handler/lifecycle/email-locale-batch.resolver';

vi.mock('@app/email-handler/lifecycle/email-locale-batch.resolver', () => ({
  batchResolveLocales: vi.fn(
    async () =>
      new Map([
        ['dual', 'en'],
        ['pl-only', 'pl'],
      ])
  ),
}));
vi.mock('@domain/notifications/push/push-dispatch.service', () => ({
  dispatchPushForNotification_IO: vi.fn(),
}));

const admin = makeStylistCurrentUser({
  user: { role_id: SystemRoleId.MASTER_ADMIN },
});
const announcement = {
  id: 'news',
  audience_client: true,
  audience_stylist: true,
  translations: { en: { title: 'News', message: 'Read [more](/blog/a)' } },
  notification_sent_at: null,
};

describe('announcement bell broadcast', () => {
  it('keeps a broadcast retryable if recipient languages cannot be resolved', async () => {
    const update = vi.fn();
    const createMany = vi.fn();
    mockDb({
      announcement: { findUnique: async () => announcement, update },
      user: { findMany: async () => [{ id: 'dual' }] },
      notification: { createMany },
    });
    vi.mocked(batchResolveLocales).mockRejectedValueOnce(
      new Error('locale store unavailable')
    );
    const result = await sendAnnouncementNotification_IO({
      id: 'news',
      currentUser: admin,
    });
    expect(result.success).toBe(false);
    expect(createMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(batchResolveLocales).toHaveBeenCalledWith(['dual'], {
      strict: true,
    });
  });
  it('selects each user once across both roles, filters language, and marks sent after inserts', async () => {
    const actions: string[] = [];
    const findMany = vi.fn(async (..._args: unknown[]) => [
      { id: 'dual' },
      { id: 'pl-only' },
    ]);
    const createMany = vi.fn(async (..._args: unknown[]) => {
      actions.push('insert');
      return { count: 1 };
    });
    const update = vi.fn(async (..._args: unknown[]) => {
      actions.push('sent');
      return announcement;
    });
    mockDb({
      announcement: { findUnique: async () => announcement, update },
      user: { findMany },
      notification: { createMany },
    });
    const result = await sendAnnouncementNotification_IO({
      id: 'news',
      currentUser: admin,
    });
    expect(result.success && result.data.created).toBe(true);
    expect(actions).toEqual(['insert', 'sent']);
    expect(createMany).toHaveBeenCalledWith({
      skipDuplicates: true,
      data: [
        {
          user_id: 'dual',
          recipient_role: null,
          type: 'SYSTEM_ANNOUNCEMENT',
          dedup_key: 'ANNOUNCEMENT:news',
          announcement_id: 'news',
          target_path: '/app/notifications',
        },
      ],
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          is_active: true,
          deleted_at: null,
          disabled_at: null,
          OR: [
            { client_account: { isNot: null } },
            { stylist_account: { isNot: null } },
          ],
        }),
      })
    );
  });
  it('does not create or dispatch again when the marker exists', async () => {
    const createMany = vi.fn();
    const findMany = vi.fn();
    mockDb({
      announcement: {
        findUnique: async () => ({
          ...announcement,
          notification_sent_at: new Date(),
        }),
      },
      user: { findMany },
      notification: { createMany },
    });
    const result = await sendAnnouncementNotification_IO({
      id: 'news',
      currentUser: admin,
    });
    expect(result.success && result.data.created).toBe(false);
    expect(createMany).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });
  it('cannot broadcast anonymous-only content', async () => {
    const update = vi.fn();
    mockDb({
      announcement: {
        findUnique: async () => ({
          ...announcement,
          audience_client: false,
          audience_stylist: false,
        }),
        update,
      },
    });
    const result = await sendAnnouncementNotification_IO({
      id: 'news',
      currentUser: admin,
    });
    expect(result.success).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
  it('does not mark sent when a batch fails, allowing the transaction to abort', async () => {
    const update = vi.fn();
    mockDb({
      announcement: { findUnique: async () => announcement, update },
      user: { findMany: async () => [{ id: 'dual' }] },
      notification: {
        createMany: async () => {
          throw new Error('database unavailable');
        },
      },
    });
    const result = await sendAnnouncementNotification_IO({
      id: 'news',
      currentUser: admin,
    });
    expect(result.success).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects a non-admin before reading recipients', async () => {
    const findMany = vi.fn();
    mockDb({ user: { findMany } });
    const result = await sendAnnouncementNotification_IO({
      id: 'news',
      currentUser: makeStylistCurrentUser(),
    });
    expect(result.success).toBe(false);
    expect(findMany).not.toHaveBeenCalled();
  });
});
