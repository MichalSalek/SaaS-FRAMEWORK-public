import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthDb } from './auth-db.fixture';
import { createSessionActivityDb } from './session-activity.fixture';
import { readLifecycleFrequency } from '@app/email-handler/lifecycle/frequency-window';
import { COUNTED_EMAIL_EVENTS } from '@app/email-handler/lifecycle/email-frequency.guard';

const url = process.env.SESSION_ACTIVITY_TEST_DATABASE_URL;
const now = new Date('2026-11-07T12:00:00Z');
const old = new Date('2026-11-03T12:00:00Z');
const recent = new Date('2026-11-06T12:00:00Z');

describe.skipIf(!url)('lifecycle frequency window on PostgreSQL', () => {
  let db: AuthDb;
  const requireCountedEvent = () => {
    const event = COUNTED_EMAIL_EVENTS[0];
    if (!event) {
      throw new Error('Expected a scheduled non-transactional event');
    }
    return event;
  };
  const countedEvent = requireCountedEvent();
  beforeAll(async () => {
    db = await createSessionActivityDb(url ?? '');
  }, 120_000);
  afterAll(async () => {
    await db?.drop();
  });

  async function seedMessage(key: string) {
    await db.seedUser(key, 'CLIENT');
    const userId = db.idOf(key);
    const message = await db.seeder.emailLifecycleMessage.create({
      data: {
        userId,
        accountId: key,
        family: 'test',
        ruleId: 'test',
        templateId: 'test',
        occurrence: 'test',
        contentVersion: '1',
        locale: 'pl',
        cohort: 'test',
        ctaIds: [],
        status: 'accepted',
        scheduledAt: old,
        createdAt: old,
      },
    });
    return { userId, messageId: message.id };
  }
  const auditRows = (userId: string, messageId: string, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      event_log_id: `${userId}_a_${String(i).padStart(5, '0')}`,
      event: countedEvent,
      event_type: 'EMAIL' as const,
      created_by_user_id: userId,
      created_at: old,
      event_payload:
        i % 2
          ? { responseBody: { lifecycleMessageId: messageId } }
          : { lifecycleMessageId: messageId },
    }));

  it('deduplicates JSON audit rows across cursor pages while preserving an independent send', async () => {
    const { userId, messageId } = await seedMessage('frequency_cursor');
    await db.seeder.eventLog.createMany({
      data: auditRows(userId, messageId, 100),
    });
    await db.seeder.eventLog.createMany({
      data: [
        {
          event_log_id: 'b_foreign',
          event: countedEvent,
          event_type: 'EMAIL',
          created_by_user_id: 'foreign-user',
          created_at: old,
        },
        {
          event_log_id: 'c_unrelated',
          event: 'NOT_A_COUNTED_EVENT',
          event_type: 'EMAIL',
          created_by_user_id: userId,
          created_at: old,
        },
        {
          event_log_id: 'd_expired',
          event: countedEvent,
          event_type: 'EMAIL',
          created_by_user_id: userId,
          created_at: new Date('2026-10-01T00:00:00Z'),
        },
      ],
    });
    expect(await readLifecycleFrequency(db.seeder, userId, now)).toBeNull();
    await db.seeder.eventLog.create({
      data: {
        event_log_id: `${userId}_z_independent`,
        event: countedEvent,
        event_type: 'EMAIL',
        created_by_user_id: userId,
        created_at: old,
        event_payload: { legacy: true },
      },
    });
    const measured = db.makeClient();
    const before = measured.count.n;
    expect(await readLifecycleFrequency(measured.client, userId, now)).toBe(
      'weekly_limit'
    );
    expect(measured.count.n - before).toBe(3);
  }, 120_000);

  it('fails closed at exactly 50 full pages and completes below that bound', async () => {
    const { userId, messageId } = await seedMessage('frequency_budget');
    await db.seeder.eventLog.createMany({
      data: auditRows(userId, messageId, 4_999),
    });
    const measured = db.makeClient();
    let before = measured.count.n;
    expect(
      await readLifecycleFrequency(measured.client, userId, now)
    ).toBeNull();
    expect(measured.count.n - before).toBe(51);
    const lastAudit = auditRows(userId, messageId, 5_000).at(-1);
    if (!lastAudit) {
      throw new Error('expected final audit row');
    }
    await db.seeder.eventLog.create({ data: lastAudit });
    before = measured.count.n;
    expect(await readLifecycleFrequency(measured.client, userId, now)).toBe(
      'frequency_unavailable'
    );
    expect(measured.count.n - before).toBe(51);
  }, 120_000);

  it('applies spacing for one recent independent event and ignores uncounted ledger states', async () => {
    await db.seedUser('frequency_recent', 'CLIENT');
    const userId = db.idOf('frequency_recent');
    await db.seeder.emailLifecycleMessage.create({
      data: {
        userId,
        accountId: 'frequency_recent',
        family: 'test',
        ruleId: 'test',
        templateId: 'test',
        occurrence: 'test',
        contentVersion: '1',
        locale: 'pl',
        cohort: 'test',
        ctaIds: [],
        status: 'failed',
        scheduledAt: recent,
        createdAt: recent,
      },
    });
    await db.seeder.eventLog.create({
      data: {
        event_log_id: 'recent',
        event: countedEvent,
        event_type: 'EMAIL',
        created_by_user_id: userId,
        created_at: recent,
      },
    });
    expect(await readLifecycleFrequency(db.seeder, userId, now)).toBe(
      'minimum_spacing'
    );
  }, 120_000);
});
