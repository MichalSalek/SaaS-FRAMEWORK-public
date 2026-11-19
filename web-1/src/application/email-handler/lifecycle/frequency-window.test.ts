import { describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { reserveLifecycleMessage } from './ledger';
import { freeFrequencyPreview_IO } from '@domain/email/operations/free-email.audience';

const now = new Date('2026-11-07T12:00:00Z');
const old = new Date('2026-11-03T12:00:00Z');
const recent = new Date('2026-11-06T12:00:00Z');
type Audit = { event_log_id: string; event_payload: unknown; created_at: Date };
const message = { id: 'm1', createdAt: old };
const duplicate = (i: number): Audit => ({
  event_log_id: String(i).padStart(5, '0'),
  event_payload: { responseBody: { lifecycleMessageId: 'm1' } },
  created_at: old,
});
const independent = (i: number, at = old): Audit => ({
  event_log_id: String(i).padStart(5, '0'),
  event_payload: {},
  created_at: at,
});
function install(messages: (typeof message)[], events: Audit[]) {
  const create = vi.fn(async () => ({ id: 'new' }));
  const emit = vi.fn(async () => ({}));
  const readMessages = vi.fn(async ({ take }: { take: number }) =>
    messages.slice(0, take)
  );
  const readEvents = vi.fn(
    async ({
      take,
      where,
    }: {
      take: number;
      where?: { event_log_id?: { gt: string } };
    }) => {
      const after = where?.event_log_id?.gt;
      const index = after ? events.findIndex(e => e.event_log_id > after) : 0;
      if (index < 0) {
        return [];
      }
      return events.slice(index, index + take);
    }
  );
  mockDb({
    emailLifecycleMessage: {
      findUnique: vi.fn(async () => null),
      findMany: readMessages,
      create,
    },
    emailDeliverySuppression: { findUnique: vi.fn(async () => null) },
    emailLifecycleOperationalEvent: { createMany: emit, create: emit },
    eventLog: { findMany: readEvents },
  });
  return { create, emit, readMessages, readEvents };
}
const input = {
  userId: 'u',
  accountId: 'a',
  family: 'trial',
  ruleId: 'r',
  templateId: 't',
  occurrence: 'x',
  contentVersion: '1',
  locale: 'pl',
  cohort: 'trial',
  ctaIds: [],
  scheduledAt: now,
  recipientEmail: 'u@example.test',
};

describe('shared lifecycle frequency window', () => {
  it('does not let correlated audit duplicates hide a weekly-cap event', async () => {
    const rows = [
      ...Array.from({ length: 100 }, (_, i) => duplicate(i)),
      independent(100),
    ];
    const f = install([message], rows);
    expect(await freeFrequencyPreview_IO('u', now)).toBe('weekly_limit');
    expect(await reserveLifecycleMessage(input, now)).toMatchObject({
      kind: 'suppressed',
      reason: 'weekly_limit',
    });
    expect(f.create).not.toHaveBeenCalled();
  });
  it('applies the 48-hour limit when exactly one independent audit is recent', async () => {
    install([], [independent(0, recent)]);
    expect(await freeFrequencyPreview_IO('u', now)).toBe('minimum_gap');
    expect(await reserveLifecycleMessage(input, now)).toMatchObject({
      kind: 'suppressed',
      reason: 'minimum_spacing',
    });
  });
  it('reports unknown and fails closed when correlated audit scanning reaches its bound', async () => {
    const rows = Array.from({ length: 5100 }, (_, i) => duplicate(i));
    const f = install([message], rows);
    expect(await freeFrequencyPreview_IO('u', now)).toBe(
      'frequency_unavailable'
    );
    expect(await reserveLifecycleMessage(input, now)).toMatchObject({
      kind: 'suppressed',
      reason: 'frequency_unavailable',
    });
    expect(f.create).not.toHaveBeenCalled();
  });
  it('still exempts transactional delivery even when history is incomplete', async () => {
    const f = install(
      [message],
      Array.from({ length: 5100 }, (_, i) => duplicate(i))
    );
    expect(
      await reserveLifecycleMessage(
        { ...input, category: 'TRANSACTIONAL' },
        now
      )
    ).toMatchObject({ kind: 'reserved' });
    expect(f.readMessages).not.toHaveBeenCalled();
    expect(f.readEvents).not.toHaveBeenCalled();
  });
  it('uses weekly limit before spacing when both are true', async () => {
    install(
      [
        { ...message, createdAt: recent },
        { id: 'm2', createdAt: recent },
      ],
      []
    );
    expect(await freeFrequencyPreview_IO('u', now)).toBe('weekly_limit');
    expect(await reserveLifecycleMessage(input, now)).toMatchObject({
      kind: 'suppressed',
      reason: 'weekly_limit',
    });
  });

  it('allows a single old independent audit outside quiet hours', async () => {
    const f = install([], [independent(0, old)]);
    expect(await freeFrequencyPreview_IO('u', now)).toBeNull();
    expect(await reserveLifecycleMessage(input, now)).toMatchObject({
      kind: 'reserved',
    });
    expect(f.create).toHaveBeenCalledTimes(1);
  });
  it('preserves the 48-hour threshold for a recent lifecycle message', async () => {
    install([{ ...message, createdAt: recent }], []);
    expect(await freeFrequencyPreview_IO('u', now)).toBe('minimum_gap');
    expect(await reserveLifecycleMessage(input, now)).toMatchObject({
      kind: 'suppressed',
      reason: 'minimum_spacing',
    });
  });
});
