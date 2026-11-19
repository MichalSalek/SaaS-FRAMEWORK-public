import { verifyFreeCohortLifecycle } from './free-cohort.assertions';
import { execFileSync } from 'node:child_process';
import { verifyMailgunDeliveryFormat } from './mailgun-delivery.assertions';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/prisma/js-client';
const holder = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    get use() {
      if (!holder.client) {
        throw new Error('Test database unavailable');
      }
      return holder.client;
    },
  },
}));
import {
  reserveLifecycleMessage,
  markLifecycleSending,
  finishLifecycleMessage,
  type LifecycleReservation,
  lifecycleAddressHash,
} from '@app/email-handler/lifecycle/ledger';
import { recordLifecycleDelivery } from '@app/email-handler/lifecycle/ledger-delivery';
import { COUNTED_EMAIL_EVENTS } from '@app/email-handler/lifecycle/email-frequency.guard';
const schema = 'lifecycle_test_' + randomUUID().replaceAll('-', '');
const url = process.env.LIFECYCLE_TEST_DATABASE_URL;
const pool = new Pool({
  connectionString: url,
  options: `-c search_path=${schema},public`,
  max: 8,
});
let client: PrismaClient;
const now = new Date('2026-10-20T12:00:00Z');
const input = (
  userId: string,
  ruleId = 'free-first-photo'
): LifecycleReservation => ({
  userId,
  accountId: userId,
  family: 'free',
  ruleId,
  templateId: ruleId,
  occurrence: 'sequence-1',
  contentVersion: '1',
  locale: 'pl',
  cohort: 'new',
  ctaIds: ['primary'],
  scheduledAt: now,
  recipientEmail: `${userId}@example.test`,
});
describe.skipIf(!url)('lifecycle reservation on real Postgres', () => {
  beforeAll(async () => {
    const sql = execFileSync(
      'npx',
      [
        'prisma',
        'migrate',
        'diff',
        '--from-empty',
        '--to-schema',
        'src/prisma/schema.prisma',
        '--script',
      ],
      { encoding: 'utf8', env: { ...process.env, DATABASE_URL: url ?? '' } }
    );
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(sql);
    client = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
    holder.client = client;
    await client.role.create({ data: { id: 'role', name: 'STYLIST' } });
    await client.user.createMany({
      data: [
        'same',
        'different',
        'legacy',
        'delivery',
        'weekly',
        'quiet',
        'budget1',
        'budget2',
        'transactional',
        'opportunity',
      ].map(id => ({
        id,
        email: `${id}@example.test`,
        role_id: 'role',
      })),
    });
  }, 30000);
  afterAll(async () => {
    if (holder.client !== null) {
      await holder.client.$disconnect();
    }
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });
  it('reserves the same occurrence once under competing processes', async () => {
    const results = await Promise.all([
      reserveLifecycleMessage(input('same'), now),
      reserveLifecycleMessage(input('same'), now),
    ]);
    expect(results.filter(row => row.kind === 'reserved')).toHaveLength(1);
    expect(
      await client.emailLifecycleMessage.count({ where: { userId: 'same' } })
    ).toBe(1);
  });
  it('serializes different messages of the same user and enforces spacing', async () => {
    const results = await Promise.all([
      reserveLifecycleMessage(input('different', 'a'), now),
      reserveLifecycleMessage(input('different', 'b'), now),
    ]);
    expect(results.filter(row => row.kind === 'reserved')).toHaveLength(1);
    expect(results).toContainEqual({
      kind: 'suppressed',
      reason: 'minimum_spacing',
    });
  });
  it('counts a wrapped legacy audit and the ledger as one send', async () => {
    const first = await reserveLifecycleMessage(
      input('legacy'),
      new Date(now.getTime() - 3 * 86400000)
    );
    if (first.kind !== 'reserved') {
      throw new Error('Expected reservation');
    }
    await client.eventLog.create({
      data: {
        created_by_user_id: 'legacy',
        event: COUNTED_EMAIL_EVENTS[0] ?? 'missing_counted_event',
        event_type: 'EMAIL',
        created_at: new Date(now.getTime() - 3 * 86400000),
        event_payload: {
          responseBody: { lifecycleMessageId: first.message.id },
        },
      },
    });
    expect(
      (await reserveLifecycleMessage(input('legacy', 'second'), now)).kind
    ).toBe('reserved');
  });
  it('enforces weekly cap including historical sends at the seven-day boundary', async () => {
    await client.eventLog.createMany({
      data: [3, 6].map(days => ({
        created_by_user_id: 'weekly',
        event: COUNTED_EMAIL_EVENTS[0] ?? 'missing_counted_event',
        event_type: 'EMAIL',
        created_at: new Date(now.getTime() - days * 86400000),
      })),
    });
    expect(await reserveLifecycleMessage(input('weekly'), now)).toEqual({
      kind: 'suppressed',
      reason: 'weekly_limit',
    });
    expect(
      (
        await reserveLifecycleMessage(
          input('weekly'),
          new Date(now.getTime() + 4 * 86400000 + 1)
        )
      ).kind
    ).toBe('reserved');
  });
  it('honors quiet hours and the exact forty-eight-hour spacing boundary', async () => {
    expect(
      await reserveLifecycleMessage(
        input('quiet'),
        new Date('2026-10-20T08:59:59Z')
      )
    ).toEqual({ kind: 'suppressed', reason: 'quiet_hours' });
    expect(
      (
        await reserveLifecycleMessage(
          input('quiet'),
          new Date('2026-10-20T09:00:00Z')
        )
      ).kind
    ).toBe('reserved');
    expect(
      (
        await reserveLifecycleMessage(
          input('quiet', 'next'),
          new Date('2026-10-22T09:00:00Z')
        )
      ).kind
    ).toBe('reserved');
  });
  it('atomically caps a shared sweep at fifty nontransactional reservations', async () => {
    const { recipientEmail: _email, ...row } = input('same');
    await client.emailLifecycleMessage.createMany({
      data: Array.from({ length: 49 }, (_, index) => ({
        ...row,
        ruleId: `budget-${index}`,
        sweepId: 'budget-sweep',
      })),
    });
    const results = await Promise.all(
      ['budget1', 'budget2'].map(id =>
        reserveLifecycleMessage({ ...input(id), sweepId: 'budget-sweep' }, now)
      )
    );
    expect(results.filter(result => result.kind === 'reserved')).toHaveLength(
      1
    );
    expect(
      await client.emailLifecycleMessage.count({
        where: { sweepId: 'budget-sweep' },
      })
    ).toBe(50);
    expect(
      (
        await reserveLifecycleMessage(
          {
            ...input('transactional'),
            category: 'TRANSACTIONAL',
            sweepId: 'budget-sweep',
          },
          new Date('2026-10-20T23:00:00Z')
        )
      ).kind
    ).toBe('reserved');
  });
  it('claims one opportunity even when the chosen template changes', async () => {
    const results = await Promise.all(
      ['photo', 'profile'].map(ruleId =>
        reserveLifecycleMessage(
          {
            ...input('opportunity', ruleId),
            opportunityId: 'first',
            category: 'TRANSACTIONAL',
          },
          now
        )
      )
    );
    expect(results.filter(result => result.kind === 'reserved')).toHaveLength(
      1
    );
    expect(results).toContainEqual({
      kind: 'suppressed',
      reason: 'opportunity_reserved',
    });
  });
  it('deduplicates webhooks and preserves complaints over late deliveries', async () => {
    const reserved = await reserveLifecycleMessage(input('delivery'), now);
    if (reserved.kind !== 'reserved') {
      throw new Error('Expected reservation');
    }
    await client.user.update({
      where: { id: 'delivery' },
      data: { email: 'changed@example.test' },
    });
    await markLifecycleSending(reserved.message.id);
    await finishLifecycleMessage(reserved.message.id, {
      status: 'unknown',
      provider: 'resend',
      reason: 'timeout',
    });
    const event = {
      provider: 'resend' as const,
      providerEventId: 'complaint-1',
      providerMessageId: 'provider-1',
      messageId: reserved.message.id,
      kind: 'complained' as const,
      occurredAt: now,
    };
    await Promise.all([
      recordLifecycleDelivery(event),
      recordLifecycleDelivery(event),
    ]);
    await recordLifecycleDelivery({
      ...event,
      providerEventId: 'delivered-1',
      kind: 'delivered',
    });
    expect(
      await client.emailDeliveryEvent.count({
        where: { messageId: reserved.message.id },
      })
    ).toBe(2);
    expect(
      (
        await client.emailLifecycleMessage.findUniqueOrThrow({
          where: { id: reserved.message.id },
        })
      ).deliveryStatus
    ).toBe('complained');
    expect(
      await client.emailDeliverySuppression.findUnique({
        where: { addressHash: lifecycleAddressHash('delivery@example.test') },
      })
    ).not.toBeNull();
    expect(
      await client.emailDeliverySuppression.findUnique({
        where: { addressHash: lifecycleAddressHash('changed@example.test') },
      })
    ).toBeNull();
    expect(
      await recordLifecycleDelivery({
        ...event,
        provider: 'mailgun',
        providerEventId: 'wrong-provider',
        providerMessageId: 'different-provider-id',
      })
    ).toBe(false);
    await recordLifecycleDelivery({
      ...event,
      providerEventId: 'older-complaint',
      occurredAt: new Date(now.getTime() - 86400000),
      replayToken: 'same-token',
    });
    await recordLifecycleDelivery({
      ...event,
      providerEventId: 'replayed-token',
      replayToken: 'same-token',
    });
    const delivered = await client.emailLifecycleMessage.findUniqueOrThrow({
      where: { id: reserved.message.id },
    });
    expect(delivered.deliveryAt).toEqual(now);
    expect(
      await client.emailDeliveryEvent.count({
        where: { messageId: reserved.message.id },
      })
    ).toBe(3);
  });
  it('closes the existing cohort once and keeps restart membership immutable', async () => {
    await verifyFreeCohortLifecycle(client, now);
  });
  it('joins legacy bracketed Mailgun send IDs with bare callback IDs without duplicate events', async () => {
    await verifyMailgunDeliveryFormat(client, now);
  });
});
