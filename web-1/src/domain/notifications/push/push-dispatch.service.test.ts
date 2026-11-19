/**
 * Push dispatch (notifications v2): consent gate, unconfigured no-op, and the
 * three delivery outcomes against the subscription rows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';

const mocks = vi.hoisted(() => ({
  openerEnabled: false,
  sendWebPush: vi.fn(
    async (..._args: unknown[]) => 'sent' as 'sent' | 'gone' | 'failed'
  ),
  isWebPushConfigured: vi.fn(() => true),
  sendFcmPush: vi.fn(
    async (..._args: unknown[]) => 'sent' as 'sent' | 'gone' | 'failed'
  ),
  isFcmConfigured: vi.fn(() => false),
  reportIssueBackend: vi.fn(),
  activityEmailsAllowed_IO: vi.fn(async (..._args: unknown[]) => true),
  batchResolveLocales: vi.fn(
    async (..._args: unknown[]) => new Map([['usr_1', 'de' as const]])
  ),
}));
vi.mock('@app/feature-flags/feature-flags.cache', () => ({
  getFeatureFlags: async () =>
    new Map([['notification_open_enabled', mocks.openerEnabled]]),
}));
vi.mock('./web-push.adapter', () => ({
  sendWebPush: mocks.sendWebPush,
  isWebPushConfigured: mocks.isWebPushConfigured,
}));
vi.mock('./fcm.adapter', () => ({
  sendFcmPush: mocks.sendFcmPush,
  isFcmConfigured: mocks.isFcmConfigured,
}));
vi.mock('@app/email-handler/activity-email-consent', () => ({
  activityEmailsAllowed_IO: mocks.activityEmailsAllowed_IO,
}));
vi.mock('@app/email-handler/lifecycle/email-locale-batch.resolver', () => ({
  batchResolveLocales: mocks.batchResolveLocales,
}));
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: mocks.reportIssueBackend,
}));

import { dispatchPushForNotification_IO } from './push-dispatch.service';

const notification = {
  id: 'ntf_1',
  user_id: 'usr_1',
  recipient_role: 'CLIENT' as const,
  type: 'PAIR_REQUEST_ACCEPTED' as const,
  dedup_key: 'PAIR_REQUEST_ACCEPTED:pair_1',
  actor_user_id: 'usr_stylist',
  actor_name: 'Studio Ani',
  target_path: '/app/gallery/stylist/acc_1',
  created_at: new Date(),
  read_at: null,
};

const subscription = {
  id: 'sub_1',
  user_id: 'usr_1',
  platform: 'WEBPUSH' as const,
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  p256dh: 'p',
  auth: 'a',
};

beforeEach(() => {
  mocks.openerEnabled = false;
  mocks.sendWebPush.mockClear();
  mocks.sendWebPush.mockResolvedValue('sent');
  mocks.isWebPushConfigured.mockReturnValue(true);
  mocks.sendFcmPush.mockResolvedValue('sent');
  mocks.isFcmConfigured.mockReturnValue(false);
  mocks.activityEmailsAllowed_IO.mockResolvedValue(true);
  mocks.batchResolveLocales.mockResolvedValue(new Map([['usr_1', 'de']]));
});

describe('dispatchPushForNotification_IO', () => {
  it('uses the owned opener only after its frontend rollout flag is enabled', async () => {
    mocks.openerEnabled = true;
    mockDb({
      pushSubscription: {
        findMany: async () => [subscription],
        updateMany: async () => ({ count: 1 }),
      },
    });
    const result = await dispatchPushForNotification_IO({
      userId: 'usr_1',
      notification,
    });
    expect(result.sent).toBe(1);
    expect(mocks.sendWebPush).toHaveBeenCalledWith(
      subscription,
      expect.objectContaining({
        url: '/app/notifications/open?id=ntf_1',
        tag: notification.dedup_key,
      })
    );
  });

  it('bounds long announcement text before transport without corrupting a Unicode code point', async () => {
    mockDb({
      pushSubscription: {
        findMany: async () => [subscription],
        updateMany: async () => ({ count: 1 }),
      },
    });
    await dispatchPushForNotification_IO({
      userId: 'usr_1',
      notification,
      copy: { title: '😀'.repeat(200), body: '💅'.repeat(2000) },
    });
    const payload = mocks.sendWebPush.mock.calls[0]?.[1] as {
      title: string;
      body: string;
    };
    expect(Array.from(payload.title)).toHaveLength(120);
    expect(Array.from(payload.body)).toHaveLength(200);
    expect(payload.title).toBe('😀'.repeat(120));
    expect(payload.body).toBe('💅'.repeat(200));
    expect(Buffer.byteLength(JSON.stringify(payload), 'utf8')).toBeLessThan(
      4096
    );
  });
  it('renders the text in the recipient language and marks the device delivered', async () => {
    const updateMany = vi.fn(async (..._args: unknown[]) => ({ count: 1 }));
    mockDb({
      pushSubscription: { findMany: async () => [subscription], updateMany },
    });
    const result = await dispatchPushForNotification_IO({
      userId: 'usr_1',
      notification,
    });
    expect(result).toEqual({ sent: 1, failed: 0, gone: 0, skipped: null });
    expect(mocks.sendWebPush).toHaveBeenCalledTimes(1);
    const payload = mocks.sendWebPush.mock.calls[0]?.[1] as {
      title: string;
      url: string;
      tag: string;
    };
    expect(payload.title).toBe('Studio Ani hat Ihre Anfrage angenommen');
    expect(payload.url).toBe('/app/notifications');
    expect(payload.tag).toBe('PAIR_REQUEST_ACCEPTED:pair_1');
    const data = (
      updateMany.mock.calls[0]?.[0] as { data: { failed_at: null } }
    ).data;
    expect(data.failed_at).toBeNull();
  });

  it('respects the activity switch: no consent, no push', async () => {
    mocks.activityEmailsAllowed_IO.mockResolvedValue(false);
    mockDb({ pushSubscription: { findMany: async () => [subscription] } });
    const result = await dispatchPushForNotification_IO({
      userId: 'usr_1',
      notification,
    });
    expect(result).toEqual({
      sent: 0,
      failed: 0,
      gone: 0,
      skipped: 'notifications-disabled',
    });
    expect(mocks.sendWebPush).not.toHaveBeenCalled();
  });

  it('a gone device (404/410) is deleted', async () => {
    mocks.sendWebPush.mockResolvedValue('gone');
    const deleteMany = vi.fn(async (..._args: unknown[]) => ({ count: 1 }));
    mockDb({
      pushSubscription: { findMany: async () => [subscription], deleteMany },
    });
    const result = await dispatchPushForNotification_IO({
      userId: 'usr_1',
      notification,
    });
    expect(result).toEqual({ sent: 0, failed: 0, gone: 1, skipped: null });
    expect(deleteMany).toHaveBeenCalledTimes(1);
  });

  it('a transient failure is remembered on the row, the device stays', async () => {
    mocks.sendWebPush.mockResolvedValue('failed');
    const updateMany = vi.fn(async (..._args: unknown[]) => ({ count: 1 }));
    const deleteMany = vi.fn(async (..._args: unknown[]) => ({ count: 0 }));
    mockDb({
      pushSubscription: {
        findMany: async () => [subscription],
        updateMany,
        deleteMany,
      },
    });
    const result = await dispatchPushForNotification_IO({
      userId: 'usr_1',
      notification,
    });
    expect(result).toEqual({ sent: 0, failed: 1, gone: 0, skipped: null });
    expect(deleteMany).not.toHaveBeenCalled();
    const data = (
      updateMany.mock.calls[0]?.[0] as { data: { failed_at: Date } }
    ).data;
    expect(data.failed_at).toBeInstanceOf(Date);
  });

  it('without any configured channel nothing is sent and nothing throws', async () => {
    mocks.isWebPushConfigured.mockReturnValue(false);
    mockDb({ pushSubscription: { findMany: async () => [subscription] } });
    await expect(
      dispatchPushForNotification_IO({ userId: 'usr_1', notification })
    ).resolves.toEqual({
      sent: 0,
      failed: 0,
      gone: 0,
      skipped: 'provider-unconfigured',
    });
    expect(mocks.sendWebPush).not.toHaveBeenCalled();
  });

  it('distinguishes an empty device list from a failed device lookup', async () => {
    mockDb({ pushSubscription: { findMany: async () => [] } });
    await expect(
      dispatchPushForNotification_IO({ userId: 'usr_1', notification })
    ).resolves.toEqual({
      sent: 0,
      failed: 0,
      gone: 0,
      skipped: 'no-devices',
    });
    mockDb({
      pushSubscription: {
        findMany: async () => {
          throw new Error('lookup unavailable');
        },
      },
    });
    await expect(
      dispatchPushForNotification_IO({ userId: 'usr_1', notification })
    ).resolves.toEqual({
      sent: 0,
      failed: 0,
      gone: 0,
      skipped: 'lookup-failed',
    });
    expect(mocks.sendWebPush).not.toHaveBeenCalled();
    expect(mocks.sendFcmPush).not.toHaveBeenCalled();
  });

  it('counts mixed transport outcomes and cleans up the respective devices', async () => {
    mocks.isFcmConfigured.mockReturnValue(true);
    mocks.sendWebPush
      .mockResolvedValueOnce('sent')
      .mockResolvedValueOnce('gone');
    mocks.sendFcmPush.mockResolvedValue('failed');
    const updateMany = vi.fn(async (..._args: unknown[]) => ({ count: 1 }));
    const deleteMany = vi.fn(async (..._args: unknown[]) => ({ count: 1 }));
    mockDb({
      pushSubscription: {
        findMany: async () => [
          subscription,
          { ...subscription, id: 'sub_2', endpoint: 'https://push.test/gone' },
          {
            ...subscription,
            id: 'sub_3',
            platform: 'FCM',
            endpoint: 'fcm-token',
          },
        ],
        updateMany,
        deleteMany,
      },
    });
    await expect(
      dispatchPushForNotification_IO({ userId: 'usr_1', notification })
    ).resolves.toEqual({ sent: 1, failed: 1, gone: 1, skipped: null });
    expect(mocks.sendFcmPush).toHaveBeenCalledWith(
      'fcm-token',
      expect.objectContaining({ url: '/app/notifications' })
    );
    expect(deleteMany).toHaveBeenCalledWith({
      where: { endpoint: 'https://push.test/gone' },
    });
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it('keeps an unconfigured device platform as a failed device when another provider is configured', async () => {
    mocks.isWebPushConfigured.mockReturnValue(false);
    mocks.isFcmConfigured.mockReturnValue(true);
    mockDb({
      pushSubscription: {
        findMany: async () => [subscription],
        updateMany: async () => ({ count: 1 }),
      },
    });
    await expect(
      dispatchPushForNotification_IO({ userId: 'usr_1', notification })
    ).resolves.toEqual({ sent: 0, failed: 1, gone: 0, skipped: null });
    expect(mocks.sendWebPush).not.toHaveBeenCalled();
    expect(mocks.sendFcmPush).not.toHaveBeenCalled();
  });

  it('reports an unexpected dispatch error without exposing its message', async () => {
    mocks.batchResolveLocales.mockRejectedValueOnce(
      new Error('private-key-value')
    );
    mockDb({ pushSubscription: { findMany: async () => [subscription] } });
    await expect(
      dispatchPushForNotification_IO({ userId: 'usr_1', notification })
    ).resolves.toEqual({
      sent: 0,
      failed: 0,
      gone: 0,
      skipped: 'dispatch-failed',
    });
    expect(mocks.reportIssueBackend).toHaveBeenCalledWith({
      namespace: 'PUSH_DISPATCH_FAILED',
      message: 'Unexpected push dispatch failure',
      payload: { userId: 'usr_1', notificationId: 'ntf_1' },
      mode: 'error',
    });
    expect(mocks.sendWebPush).not.toHaveBeenCalled();
  });

  it('awaits other devices after an unexpected transport rejection and retains accepted counts', async () => {
    mocks.sendWebPush
      .mockRejectedValueOnce(new Error('transport failed unexpectedly'))
      .mockImplementationOnce(async () => {
        await Promise.resolve();
        return 'sent';
      });
    mockDb({
      pushSubscription: {
        findMany: async () => [
          subscription,
          {
            ...subscription,
            id: 'sub_2',
            endpoint: 'https://push.test/accepted',
          },
        ],
        updateMany: async () => ({ count: 1 }),
      },
    });
    await expect(
      dispatchPushForNotification_IO({ userId: 'usr_1', notification })
    ).resolves.toEqual({
      sent: 1,
      failed: 0,
      gone: 0,
      skipped: 'dispatch-failed',
    });
    expect(mocks.sendWebPush).toHaveBeenCalledTimes(2);
  });
});
