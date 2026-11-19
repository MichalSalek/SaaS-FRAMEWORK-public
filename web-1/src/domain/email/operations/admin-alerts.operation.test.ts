import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
const { sendAlert, recordAudit } = vi.hoisted(() => ({
  sendAlert: vi.fn(async () => true),
  recordAudit: vi.fn(async () => undefined),
}));
vi.mock('@app/email-handler/email.operations', () => ({
  sendCriticalBusinessAlert: sendAlert,
}));
vi.mock('@app/event-log/event-log-io.wrapper', () => ({
  recordAuditEvent_IO: recordAudit,
}));
vi.mock('@app/event-log/system-actor', () => ({
  resolveSystemActorId_IO: async () => 'admin',
}));
import {
  sendDailySignupDigest_IO,
  sendChurnAlert_IO,
  sendDowngradeAlert_IO,
  signupDigestLines,
  signupOnboardingState,
} from './admin-alerts.operation';

describe('subscription admin alert audit payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendAlert.mockResolvedValue(true);
  });

  it('delivers the cancellation address without placing it in the durable audit body', async () => {
    await sendChurnAlert_IO({
      accountId: 'account',
      userId: 'user',
      email: 'recipient@example.test',
      plan: 'Studio',
    });

    expect(sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ email: 'recipient@example.test' }),
      })
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        responseBody: { accountId: 'account', plan: 'Studio' },
      })
    );
  });

  it('does not record an alert as sent when its transport did not deliver', async () => {
    sendAlert.mockResolvedValue(false);
    await sendChurnAlert_IO({
      accountId: 'account',
      userId: 'user',
      email: 'recipient@example.test',
      plan: 'Studio',
    });
    await sendDowngradeAlert_IO({
      accountId: 'account',
      userId: 'user',
      email: 'recipient@example.test',
      oldPlan: 'Studio',
      newPlan: 'Pro',
    });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('keeps downgrade identities in the actor and excludes the address from its audit body', async () => {
    await sendDowngradeAlert_IO({
      accountId: 'account',
      userId: 'user',
      email: 'recipient@example.test',
      oldPlan: 'Studio',
      newPlan: 'Pro',
    });

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        user: { id: 'user' },
        responseBody: {
          accountId: 'account',
          oldPlan: 'Studio',
          newPlan: 'Pro',
        },
      })
    );
  });
});

describe('signupOnboardingState', () => {
  it('names the finished role', () => {
    expect(
      signupOnboardingState({ stylist_account: {}, client_account: null })
    ).toBe('stylist');
    expect(
      signupOnboardingState({ stylist_account: null, client_account: {} })
    ).toBe('client');
    expect(
      signupOnboardingState({ stylist_account: {}, client_account: {} })
    ).toBe('stylist + client');
  });

  it('flags a person who never picked a role', () => {
    expect(
      signupOnboardingState({ stylist_account: null, client_account: null })
    ).toBe('not finished');
  });

  it('reports a missing user row as unknown', () => {
    expect(signupOnboardingState(undefined)).toBe('unknown');
  });
});

describe('signupDigestLines', () => {
  it('lists people without a finished onboarding first, in Polish', () => {
    const lines = signupDigestLines([
      {
        email: 'stylistka@example.test',
        createdAt: '2026-09-23T08:00:00Z',
        onboarding: 'stylist',
      },
      {
        email: 'emilia@example.test',
        createdAt: '2026-09-23T11:04:00Z',
        onboarding: 'not finished',
      },
    ]);
    expect(lines).toEqual([
      'emilia@example.test (onboarding nieukończony), 23.09, 13:04',
      'stylistka@example.test (stylistka), 23.09, 10:00',
    ]);
  });
});

describe('signup digest bounded user lookup', () => {
  it('fetches every unique id from a maximum-size signup batch', async () => {
    const events = Array.from({ length: 100 }, (_, i) => ({
      created_by_user_id: `u${i}`,
      created_at: new Date(),
      event_payload: null,
    }));
    const users = events.map(e => ({
      id: e.created_by_user_id,
      email: `${e.created_by_user_id}@example.test`,
      name: '',
      stylist_account: null,
      client_account: null,
    }));
    const eventQuery = vi.fn(async ({ take }: { take: number }) =>
      events.slice(0, take)
    );
    const userQuery = vi.fn(
      async ({
        take,
        where,
      }: {
        take: number;
        where: { id: { in: string[] } };
      }) => users.filter(u => where.id.in.includes(u.id)).slice(0, take)
    );
    mockDb({
      eventLog: { findFirst: vi.fn(async () => null), findMany: eventQuery },
      user: { findMany: userQuery },
    });
    sendAlert.mockClear();
    sendAlert.mockResolvedValue(true);
    await sendDailySignupDigest_IO();
    const eventCall = eventQuery.mock.calls[0]?.[0];
    const userCall = userQuery.mock.calls[0]?.[0];
    if (!eventCall || !userCall) {
      throw new Error('expected both digest queries');
    }
    expect(eventCall.take).toBe(100);
    expect(userCall.take).toBeGreaterThanOrEqual(users.length);
    expect(sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          count: 100,
          signups: expect.not.arrayContaining([
            expect.objectContaining({ email: 'unknown' }),
          ]),
        }),
      })
    );
  });
});
