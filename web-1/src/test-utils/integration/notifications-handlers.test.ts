/**
 * Notification centre handlers (notifications v2) through the real middleware:
 * the active role scopes the rows, both roles may read, anonymous gets 401,
 * mark-read validates its timestamp, push register validates the endpoint.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import recentHandler from '../../pages/api/v1/notifications/recent/index';
import unreadHandler from '../../pages/api/v1/notifications/unread-count/index';
import markReadHandler from '../../pages/api/v1/notifications/mark-read/index';
import registerHandler from '../../pages/api/v1/notifications/push/register/index';
import unregisterHandler from '../../pages/api/v1/notifications/push/unregister/index';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import {
  __resetCurrentUser,
  __setCurrentUser,
  __setPermission,
} from '../setup';
import {
  makeClientCurrentUser,
  makeCurrentUserOutput,
  makeStylistCurrentUser,
} from '../fixtures';

beforeEach(() => {
  __setPermission(null); // the real SSOT matrix: LOGGED_USER grants
});

describe('GET notifications/recent', () => {
  it('scopes the rows by the ACTIVE role of the caller (client)', async () => {
    __setCurrentUser(makeCurrentUserOutput(makeClientCurrentUser()));
    const findMany = vi.fn(async (..._args: unknown[]) => []);
    const count = vi.fn(async (..._args: unknown[]) => 0);
    mockDb({ notification: { findMany, count } });
    const { status, data } = await mockApiHandler<{
      notifications: unknown[];
      unread_count: number;
    }>(recentHandler, { method: 'GET' });
    expect(status).toBe(200);
    expect(data).toEqual({ notifications: [], unread_count: 0 });
    const where = (
      findMany.mock.calls[0]?.[0] as {
        where: {
          user_id: string;
          OR: Array<{ recipient_role: string | null }>;
        };
      }
    ).where;
    expect(where.user_id).toBe('usr_test_0000000000000002');
    expect(where.OR).toEqual([
      { recipient_role: null },
      { recipient_role: 'CLIENT' },
    ]);
  });

  it('a stylist reads the same list in her role', async () => {
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    const findMany = vi.fn(async (..._args: unknown[]) => []);
    mockDb({ notification: { findMany, count: async () => 0 } });
    const { status } = await mockApiHandler(recentHandler, { method: 'GET' });
    expect(status).toBe(200);
    const where = (
      findMany.mock.calls[0]?.[0] as {
        where: { OR: Array<{ recipient_role: string | null }> };
      }
    ).where;
    expect(where.OR[1]).toEqual({ recipient_role: 'STYLIST' });
  });

  it('anonymous is refused', async () => {
    __resetCurrentUser();
    mockDb({});
    const { status } = await mockApiHandler(recentHandler, { method: 'GET' });
    expect(status).toBe(401);
  });
});

describe('GET notifications/unread-count', () => {
  it('returns the count for the caller', async () => {
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    mockDb({ notification: { count: async () => 4 } });
    const { status, data } = await mockApiHandler<{ unread_count: number }>(
      unreadHandler,
      { method: 'GET' }
    );
    expect(status).toBe(200);
    expect(data.unread_count).toBe(4);
  });
});

describe('POST notifications/mark-read', () => {
  it('marks up to the newest seen row', async () => {
    __setCurrentUser(makeCurrentUserOutput(makeClientCurrentUser()));
    const updateMany = vi.fn(async (..._args: unknown[]) => ({ count: 2 }));
    mockDb({ notification: { updateMany } });
    const { status, data } = await mockApiHandler<{ marked: number }>(
      markReadHandler,
      { method: 'POST', body: { newest_seen_at: '2026-10-19T12:00:00.000Z' } }
    );
    expect(status).toBe(200);
    expect(data.marked).toBe(2);
    const where = (
      updateMany.mock.calls[0]?.[0] as { where: { created_at: { lte: Date } } }
    ).where;
    expect(where.created_at.lte.toISOString()).toBe('2026-10-19T12:00:00.000Z');
  });

  it('rejects a timestamp that is not a date', async () => {
    __setCurrentUser(makeCurrentUserOutput(makeClientCurrentUser()));
    mockDb({});
    const { status } = await mockApiHandler(markReadHandler, {
      method: 'POST',
      body: { newest_seen_at: 'yesterday' },
    });
    expect(status).toBe(400);
  });
});

describe('POST notifications/push/register', () => {
  it('stores a web push device for the caller and audits the platform only', async () => {
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    const upsert = vi.fn(async (..._args: unknown[]) => ({ id: 'sub_1' }));
    mockDb({ pushSubscription: { upsert } });
    const { status, data } = await mockApiHandler<{ subscription_id: string }>(
      registerHandler,
      {
        method: 'POST',
        body: {
          platform: 'WEBPUSH',
          endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
          p256dh: 'BPublicKey',
          auth: 'authSecret',
        },
      }
    );
    expect(status).toBe(200);
    expect(data.subscription_id).toBe('sub_1');
    const args = upsert.mock.calls[0]?.[0] as {
      where: { endpoint: string };
      update: { user_id: string; failed_at: null };
    };
    expect(args.where.endpoint).toBe(
      'https://fcm.googleapis.com/fcm/send/abc123'
    );
    expect(args.update.user_id).toBe('usr_test_0000000000000001');
    expect(args.update.failed_at).toBeNull();
  });

  it('refuses a web push endpoint that is not a public https host', async () => {
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    mockDb({});
    for (const endpoint of [
      'http://push.example/x',
      'https://127.0.0.1/x',
      'https://localhost/x',
      'https://user:pw@push.example/x',
    ]) {
      const { status } = await mockApiHandler(registerHandler, {
        method: 'POST',
        body: { platform: 'WEBPUSH', endpoint, p256dh: 'p', auth: 'a' },
      });
      expect(status, endpoint).toBe(400);
    }
  });

  it('a web push device without keys is refused; an FCM token needs none', async () => {
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    mockDb({ pushSubscription: { upsert: async () => ({ id: 'sub_2' }) } });
    const noKeys = await mockApiHandler(registerHandler, {
      method: 'POST',
      body: { platform: 'WEBPUSH', endpoint: 'https://web.push.apple.com/x' },
    });
    expect(noKeys.status).toBe(400);
    const fcm = await mockApiHandler(registerHandler, {
      method: 'POST',
      body: {
        platform: 'FCM',
        endpoint: 'dGhpc2lzYXZlcnlsb25nZmNtdG9rZW46QVBBOTE_abc-def',
      },
    });
    expect(fcm.status).toBe(200);
  });
});

describe('POST notifications/push/unregister', () => {
  it('removes only the caller’s device; a foreign endpoint is a quiet false', async () => {
    __setCurrentUser(makeCurrentUserOutput(makeClientCurrentUser()));
    const deleteMany = vi.fn(async (..._args: unknown[]) => ({ count: 0 }));
    mockDb({ pushSubscription: { deleteMany } });
    const { status, data } = await mockApiHandler<{ removed: boolean }>(
      unregisterHandler,
      {
        method: 'POST',
        body: { endpoint: 'https://fcm.googleapis.com/fcm/send/foreign' },
      }
    );
    expect(status).toBe(200);
    expect(data.removed).toBe(false);
    const where = (
      deleteMany.mock.calls[0]?.[0] as { where: { user_id: string } }
    ).where;
    expect(where.user_id).toBe('usr_test_0000000000000002');
  });
});
