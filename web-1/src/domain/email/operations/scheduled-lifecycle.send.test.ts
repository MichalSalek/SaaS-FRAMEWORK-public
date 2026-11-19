import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
const transport = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@app/email-handler/lifecycle/measured-transport', () => ({
  sendMeasuredLifecycleEmail: transport.send,
}));
import { sendScheduledLifecycleEmail } from './scheduled-lifecycle.send';

const input = {
  userId: 'owner',
  accountId: 'account',
  email: 'owner@example.test',
  family: 'trial',
  ruleId: 'TRIAL_D1_NUDGE',
  occurrence: 'trial:2026-10-20',
  templateId: 'trial-nudge-upload',
  subjectKey: 'email.trial.d1Nudge.subject',
  locale: 'pl' as const,
  category: 'TRIAL_SEQUENCE' as const,
  vars: {},
  unsubscribeUrl: 'https://nailfolio.app/email/unsubscribe?token=opaque',
  sweepId: 'shared-sweep',
};
const user = {
  email: input.email,
  is_active: true,
  deleted_at: null,
  disabled_at: null,
  stylist_account: { email_trial_sequence: true, email_marketing: true },
};

describe('scheduled lifecycle freshness', () => {
  beforeEach(() => {
    transport.send.mockReset();
    transport.send.mockImplementation(
      async (request: { validate: () => Promise<boolean> }) => ({
        status: (await request.validate()) ? 'accepted' : 'suppressed',
      })
    );
  });
  it.each([
    { ...user, email: 'changed@example.test' },
    { ...user, is_active: false },
    { ...user, disabled_at: new Date() },
    {
      ...user,
      stylist_account: { email_trial_sequence: false, email_marketing: true },
    },
  ])(
    'stops when recipient, liveness or preference changes before sending',
    async row => {
      mockDb({ user: { findUnique: async () => row } });
      expect((await sendScheduledLifecycleEmail(input)).status).toBe(
        'suppressed'
      );
    }
  );
  it('rechecks schedule eligibility and forwards the same occurrence and sweep', async () => {
    mockDb({ user: { findUnique: async () => user } });
    const validate = vi.fn(async () => false);
    expect(
      (await sendScheduledLifecycleEmail({ ...input, validate })).status
    ).toBe('suppressed');
    expect(validate).toHaveBeenCalledOnce();
    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({
        occurrence: input.occurrence,
        sweepId: 'shared-sweep',
        userId: 'owner',
      })
    );
  });
  it('permits a recoverable deletion winback while preserving address and ban checks', async () => {
    mockDb({
      user: {
        findUnique: async () => ({
          ...user,
          deleted_at: new Date(),
          is_active: false,
        }),
      },
    });
    expect(
      (
        await sendScheduledLifecycleEmail({
          ...input,
          allowDeleted: true,
          category: 'MARKETING',
        })
      ).status
    ).toBe('accepted');
  });
});
