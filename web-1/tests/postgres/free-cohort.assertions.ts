import { expect } from 'vitest';
import type { PrismaClient } from '../../src/prisma/js-client';
import { FREE_EMAIL_CONFIG } from '@kernel/domain/email/email-free.config';
import {
  initializeFreeEmailCampaign_IO,
  enrollFreeOnboarding_IO,
} from '@domain/email/operations/free-email.enrollment';

/** Exercises the immutable snapshot and first explicit onboarding on the isolated test schema. */
export const verifyFreeCohortLifecycle = async (
  client: PrismaClient,
  now: Date
): Promise<void> => {
  const beforeLaunch = new Date(now.getTime() - 86400000);
  await client.user.createMany({
    data: ['existing-onboarded', 'role-only'].map(id => ({
      id,
      email: `${id}@example.test`,
      role_id: 'role',
    })),
  });
  await client.stylistAccount.createMany({
    data: ['existing-onboarded', 'role-only'].map(id => ({
      account_id: id,
      created_by_user_id: id,
      created_at: beforeLaunch,
      pricing_plan: 'FREE',
      payment_status: 'UNPAID',
      account_status: 'ACTIVE',
    })),
  });
  await client.eventLog.create({
    data: {
      event: 'STYLIST_ACCOUNT_CREATED',
      event_type: 'ACCOUNT',
      created_by_user_id: 'existing-onboarded',
      created_at: beforeLaunch,
    },
  });
  await client.emailLifecycleCampaign.create({
    data: {
      id: FREE_EMAIL_CONFIG.CAMPAIGN_ID,
      mode: 'PREVIEW',
      startedAt: now,
    },
  });
  await initializeFreeEmailCampaign_IO(now);
  const initial = await client.emailLifecycleCampaign.findUniqueOrThrow({
    where: { id: FREE_EMAIL_CONFIG.CAMPAIGN_ID },
  });
  expect(initial.initializedAt).toEqual(now);
  expect(
    await client.freeEmailEnrollment.findUnique({
      where: { accountId: 'existing-onboarded' },
    })
  ).toMatchObject({ cohort: 'existing', startedAt: now });
  expect(
    await client.freeEmailEnrollment.findUnique({
      where: { accountId: 'role-only' },
    })
  ).toBeNull();
  const firstOnboarding = new Date(now.getTime() + 3600000);
  await client.$transaction(tx =>
    enrollFreeOnboarding_IO(tx, 'role-only', 'role-only', firstOnboarding)
  );
  expect(
    await client.freeEmailEnrollment.findUnique({
      where: { accountId: 'role-only' },
    })
  ).toMatchObject({ cohort: 'new', startedAt: firstOnboarding });
  await client.$transaction(tx =>
    enrollFreeOnboarding_IO(
      tx,
      'existing-onboarded',
      'existing-onboarded',
      firstOnboarding
    )
  );
  expect(
    await client.freeEmailEnrollment.findUnique({
      where: { accountId: 'existing-onboarded' },
    })
  ).toMatchObject({ cohort: 'existing', startedAt: now });
  await initializeFreeEmailCampaign_IO(new Date(now.getTime() + 86400000));
  const restarted = await client.emailLifecycleCampaign.findUniqueOrThrow({
    where: { id: FREE_EMAIL_CONFIG.CAMPAIGN_ID },
  });
  expect(restarted.initializedAt).toEqual(now);
  expect(
    await client.freeEmailEnrollment.count({ where: { cohort: 'existing' } })
  ).toBe(1);
};
