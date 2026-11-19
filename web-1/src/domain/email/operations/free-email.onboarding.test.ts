import { describe, expect, it, vi } from 'vitest';
import { DB_CLIENT } from '@app/db/db.client';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { enrollFreeOnboarding_IO } from './free-email.enrollment';
const launch = new Date('2026-10-19T12:00:00Z');
const completed = new Date('2026-10-20T12:00:00Z');
function install(
  previous: { event: string; event_type: string; created_at: Date } | null
) {
  const createMany = vi.fn(async (_args: unknown) => ({ count: 1 }));
  mockDb({
    emailLifecycleCampaign: { findUnique: async () => ({ startedAt: launch }) },
    eventLog: {
      findFirst: async ({
        where,
      }: {
        where: { event: string; event_type: string; created_at: { lte: Date } };
      }) =>
        previous &&
        previous.event === where.event &&
        previous.event_type === where.event_type &&
        previous.created_at <= where.created_at.lte
          ? { event_log_id: 'previous' }
          : null,
    },
    // This account existed before launch only because role switching auto-provisioned it.
    stylistAccount: {
      findUnique: async () => ({
        created_at: new Date('2026-09-01'),
        email_trial_sequence: true,
        trial_started_at: null,
        subscription_id: null,
        pricing_plan: 'FREE',
      }),
    },
    freeEmailEnrollment: { createMany },
  });
  return createMany;
}
describe('Free enrollment follows first explicit stylist onboarding', () => {
  it('enrolls an old role-provisioned account on its first successful onboarding after launch', async () => {
    const create = install(null);
    await enrollFreeOnboarding_IO(DB_CLIENT.use, 'user', 'account', completed);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            cohort: 'new',
            startedAt: completed,
            userId: 'user',
            accountId: 'account',
          }),
        ],
        skipDuplicates: true,
      })
    );
  });
  it('does not restart an existing completed onboarding when its form is resubmitted', async () => {
    const create = install({
      event: 'STYLIST_ACCOUNT_CREATED',
      event_type: 'ACCOUNT',
      created_at: new Date(launch.getTime() - 86400000),
    });
    await enrollFreeOnboarding_IO(DB_CLIENT.use, 'user', 'account', completed);
    expect(create).not.toHaveBeenCalled();
  });
  it('also refuses a repeat of an onboarding completed after launch', async () => {
    const create = install({
      event: 'STYLIST_ACCOUNT_CREATED',
      event_type: 'ACCOUNT',
      created_at: new Date(launch.getTime() + 1000),
    });
    await enrollFreeOnboarding_IO(DB_CLIENT.use, 'user', 'account', completed);
    expect(create).not.toHaveBeenCalled();
  });
  it('does not confuse role changes or unrelated event categories with successful onboarding', async () => {
    for (const prior of [
      {
        event: 'USER_ROLE_SWITCHED',
        event_type: 'ACCOUNT',
        created_at: launch,
      },
      {
        event: 'STYLIST_ACCOUNT_CREATED',
        event_type: 'INFO',
        created_at: launch,
      },
    ]) {
      const create = install(prior);
      await enrollFreeOnboarding_IO(
        DB_CLIENT.use,
        'user',
        'account',
        completed
      );
      expect(create).toHaveBeenCalledTimes(1);
    }
  });
});
