import { beforeEach, describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({
  audit: vi.fn(),
  failUpdate: false,
  flags: { email_trial_sequence: true, email_marketing: false },
  outbox: vi.fn(),
  lock: vi.fn(),
  close: vi.fn(),
  latest: vi.fn(),
}));
vi.mock('@app/event-log/event-log-io.wrapper', () => ({
  recordAuditEvent_IO: io.audit,
}));
vi.mock('@app/runtime/run-after-response', () => ({
  runAfterResponse: (task: () => Promise<unknown>) => {
    void task();
  },
}));
vi.mock('@app/db/db.client', () => {
  const account = {
    findFirst: async () => ({ account_id: 'account', ...io.flags }),
    findUniqueOrThrow: async () => ({ ...io.flags }),
    update: async ({
      data,
    }: {
      data: { email_trial_sequence: boolean; email_marketing: boolean };
    }) => {
      if (io.failUpdate) {
        throw new Error('write failed');
      }
      io.flags = {
        email_trial_sequence: data.email_trial_sequence,
        email_marketing: data.email_marketing,
      };
    },
  };
  const tx = {
    $queryRaw: io.lock,
    stylistAccount: account,
    freeEmailEnrollment: { updateMany: io.close },
    emailLifecycleMessage: { findFirst: io.latest },
    emailLifecycleOperationalEvent: { create: io.outbox },
  };
  return {
    DB_CLIENT: {
      use: {
        ...tx,
        $transaction: async (fn: (client: typeof tx) => Promise<unknown>) =>
          fn(tx),
      },
    },
  };
});
vi.mock('@app/email-handler/email-unsubscribe.token', () => ({
  verifyUnsubscribeToken: () => ({
    userId: 'owner',
    category: 'TRIAL_SEQUENCE',
    timestamp: Date.now(),
  }),
}));
import { updateEmailPreferences_IO } from './email-preferences.operations';
import { processUnsubscribe_IO } from './email-unsubscribe.operations';
import { scheduleEmailPreferenceAudit } from './email-preferences.audit';
describe('lifecycle unsubscribe reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    io.failUpdate = false;
    io.flags = { email_trial_sequence: true, email_marketing: false };
    io.lock.mockResolvedValue([{ account_id: 'account' }]);
    io.latest.mockResolvedValue(null);
  });
  it('records the first unchecked choice and skips an unchanged later submission', () => {
    const preferences = { trial_sequence: true, marketing: false };
    scheduleEmailPreferenceAudit({
      userId: 'owner',
      accountId: 'account',
      source: 'registration',
      before: null,
      after: preferences,
    });
    scheduleEmailPreferenceAudit({
      userId: 'owner',
      accountId: 'account',
      source: 'account_settings',
      before: preferences,
      after: preferences,
    });
    expect(io.audit).toHaveBeenCalledTimes(1);
    expect(io.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        responseBody: expect.objectContaining({
          source: 'registration',
          previous_preferences: null,
          preferences,
        }),
      })
    );
  });

  it('records the committed before/after state and each capture surface, without duplicate history', async () => {
    await updateEmailPreferences_IO(
      'owner',
      { trial_sequence: true, marketing: true },
      'first_photo'
    );
    expect(io.audit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        responseBody: {
          account_id: 'account',
          source: 'first_photo',
          previous_preferences: { trial_sequence: true, marketing: false },
          preferences: { trial_sequence: true, marketing: true },
        },
      })
    );
    await updateEmailPreferences_IO(
      'owner',
      { trial_sequence: true, marketing: true },
      'first_photo'
    );
    expect(io.audit).toHaveBeenCalledTimes(1);
    await updateEmailPreferences_IO(
      'owner',
      { trial_sequence: true, marketing: false },
      'account_settings'
    );
    expect(io.audit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        responseBody: expect.objectContaining({
          source: 'account_settings',
          previous_preferences: { trial_sequence: true, marketing: true },
        }),
      })
    );
  });
  it('labels an older client explicitly and does not audit a rejected database write', async () => {
    await updateEmailPreferences_IO('owner', {
      trial_sequence: true,
      marketing: true,
    });
    expect(io.audit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        responseBody: expect.objectContaining({ source: 'unspecified' }),
      })
    );
    io.audit.mockClear();
    io.failUpdate = true;
    const result = await updateEmailPreferences_IO(
      'owner',
      { trial_sequence: true, marketing: false },
      'account_settings'
    );
    expect(result.success).toBe(false);
    expect(io.audit).not.toHaveBeenCalled();
  });
  it('records a settings unsubscribe only for an actual true-to-false change', async () => {
    expect(
      (
        await updateEmailPreferences_IO('owner', {
          trial_sequence: false,
          marketing: false,
        })
      ).success
    ).toBe(true);
    expect(
      (
        await updateEmailPreferences_IO('owner', {
          trial_sequence: false,
          marketing: false,
        })
      ).success
    ).toBe(true);
    expect(io.outbox).toHaveBeenCalledTimes(1);
    expect(io.outbox).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'unsubscribed',
          state: 'unsubscribed',
          dimensions: expect.objectContaining({ family: 'free' }),
        }),
      })
    );
    expect(io.lock).toHaveBeenCalledTimes(2);
  });
  it('counts a repeated unsubscribe link once and keeps it idempotent', async () => {
    expect((await processUnsubscribe_IO('valid')).success).toBe(true);
    expect(await processUnsubscribe_IO('valid')).toEqual({
      success: true,
      data: { category: 'TRIAL_SEQUENCE', already_unsubscribed: true },
    });
    expect(io.outbox).toHaveBeenCalledTimes(1);
    expect(io.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        responseBody: expect.objectContaining({
          source: 'unsubscribe_link',
          previous_preferences: { marketing: false, trial_sequence: true },
          preferences: { marketing: false, trial_sequence: false },
        }),
      })
    );
  });
  it('attributes the unsubscribe to the last accepted message of the matching family', async () => {
    io.latest.mockResolvedValue({
      id: 'last-message',
      family: 'trial',
      templateId: 'trial-nudge',
      ruleId: 'trial-day-1',
      locale: 'en',
      cohort: 'existing',
      provider: 'mailgun',
    });
    await updateEmailPreferences_IO('owner', {
      trial_sequence: false,
      marketing: false,
    });
    expect(io.outbox).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          messageId: 'last-message',
          dimensions: expect.objectContaining({
            family: 'trial',
            locale: 'en',
            transport: 'mailgun',
          }),
        }),
      })
    );
  });
});
