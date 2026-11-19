import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../src/prisma/js-client';
import type { AuthDb } from './auth-db.fixture';
import { createSessionActivityDb } from './session-activity.fixture';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

const holder = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    get use() {
      if (!holder.client) {
        throw new Error('No test DB');
      }
      return holder.client;
    },
  },
}));
import {
  fetchRenewalReminderSent,
  queryRenewalReminderCandidates,
} from '@domain/email/operations/renewal-reminder.operation';
import {
  fetchOnboardingAbandonmentSent,
  queryOnboardingAbandonmentCandidates,
} from '@domain/email/operations/onboarding-abandonment.operation';
import {
  fetchWinbackDeletionSent,
  queryWinbackDeletionCandidates,
} from '@domain/email/operations/winback-deletion.operation';

const url = process.env.SESSION_ACTIVITY_TEST_DATABASE_URL;
describe.skipIf(!url)('renewal selection on real PostgreSQL', () => {
  let db: AuthDb;
  beforeAll(async () => {
    db = await createSessionActivityDb(url ?? '');
    holder.client = db.seeder;
  }, 120_000);
  afterAll(async () => {
    holder.client = null;
    await db?.drop();
  });

  it('does not let duplicate audit rows or sent/cancelled accounts occupy the candidate cap', async () => {
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    for (let i = 0; i < 53; i++) {
      const key = `renew_${String(i).padStart(2, '0')}`;
      await db.seedUser(key, 'STYLIST', 'STUDIO');
      await db.seeder.stylistAccount.update({
        where: { account_id: `sa_${key}` },
        data: {
          current_period_end: periodEnd,
          cancel_at_period_end: i === 50,
        },
      });
    }
    for (let i = 0; i < 50; i++) {
      const user = db.idOf(`renew_${String(i).padStart(2, '0')}`);
      await db.seeder.eventLog.create({
        data: {
          created_by_user_id: user,
          event: APP_EVENTS.INFO.EMAIL.EMAIL_RENEWAL_REMINDER_7D_SENT,
          event_type: 'EMAIL',
        },
      });
    }
    const a = db.idOf('renew_00');
    const b = db.idOf('renew_01');
    await db.seeder.eventLog.create({
      data: {
        created_by_user_id: a,
        event: APP_EVENTS.INFO.EMAIL.EMAIL_RENEWAL_REMINDER_7D_SENT,
        event_type: 'EMAIL',
      },
    });
    expect(await fetchRenewalReminderSent([a, b], now)).toEqual(
      new Set([a, b])
    );
    const candidates = await queryRenewalReminderCandidates(now);
    expect(candidates.map(row => row.account_id)).toEqual([
      'sa_renew_51',
      'sa_renew_52',
    ]);
  }, 120_000);
  it('selects unsent onboarding and winback users beyond already-sent caps', async () => {
    const now = new Date();
    const hour = 60 * 60 * 1000;
    const onboarding = Array.from(
      { length: 52 },
      (_, i) => `onboard_${String(i).padStart(3, '0')}`
    );
    const winback = Array.from(
      { length: 202 },
      (_, i) => `winback_${String(i).padStart(3, '0')}`
    );
    await db.seeder.user.createMany({
      data: [
        ...onboarding.map(id => ({
          id,
          email: `${id}@example.test`,
          role_id: 'role_client',
          createdAt: new Date(now.getTime() - 30 * hour),
        })),
        ...winback.map(id => ({
          id,
          email: `${id}@example.test`,
          role_id: 'role_stylist',
          is_active: false,
          recovery_available: true,
          deleted_at: new Date(now.getTime() - 60 * 24 * hour),
        })),
      ],
    });
    await db.seeder.stylistAccount.createMany({
      data: winback.map(id => ({
        account_id: `sa_${id}`,
        created_by_user_id: id,
        email_marketing: true,
        pricing_plan: 'FREE',
        payment_status: 'UNPAID',
        account_status: 'ACTIVE',
      })),
    });
    await db.seeder.eventLog.createMany({
      data: [
        ...onboarding.slice(0, 50).map(id => ({
          created_by_user_id: id,
          event: APP_EVENTS.INFO.EMAIL.EMAIL_ONBOARDING_INCOMPLETE_24H_SENT,
          event_type: 'EMAIL' as const,
        })),
        ...winback.slice(0, 200).map(id => ({
          created_by_user_id: id,
          event: APP_EVENTS.INFO.EMAIL.EMAIL_WINBACK_DELETION_D60_SENT,
          event_type: 'EMAIL' as const,
        })),
        ...[onboarding[0], onboarding[0], winback[0], winback[0]].map(
          (id, i) => ({
            created_by_user_id: id ?? '',
            event:
              i < 2
                ? APP_EVENTS.INFO.EMAIL.EMAIL_ONBOARDING_INCOMPLETE_24H_SENT
                : APP_EVENTS.INFO.EMAIL.EMAIL_WINBACK_DELETION_D60_SENT,
            event_type: 'EMAIL' as const,
          })
        ),
      ],
    });
    expect(
      await fetchOnboardingAbandonmentSent(onboarding.slice(0, 2))
    ).toEqual(new Set(onboarding.slice(0, 2)));
    expect(await fetchWinbackDeletionSent(winback.slice(0, 2))).toEqual(
      new Set(winback.slice(0, 2))
    );
    expect(
      (await queryOnboardingAbandonmentCandidates(now)).map(row => row.id)
    ).toEqual(onboarding.slice(50));
    expect(
      (await queryWinbackDeletionCandidates(now)).map(row => row.id)
    ).toEqual(winback.slice(200));
  }, 120_000);
});
