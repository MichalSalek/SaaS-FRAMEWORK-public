import { beforeEach, describe, expect, it, vi } from 'vitest';
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: { use: { $queryRaw: query } },
}));
import { getLifecycleActions } from './lifecycle-actions.query';
const now = new Date('2026-10-21T12:00:00Z');
const row = {
  id: 'action',
  accountId: 'target-account',
  occurredAt: now,
  entryId: 'last-entry',
  messageId: 'last-mail',
  ctaId: 'primary',
  enteredAt: new Date(now.getTime() - 2 * 86400000),
  family: 'free',
  ruleId: 'free-first-client',
  templateId: 'free-first-client',
  locale: 'pl',
  cohort: 'new',
  provider: 'resend',
};

describe('confirmed stylist action attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.mockResolvedValue([row]);
  });
  it('uses one bound SQL query for both owner-scoped receipts and latest matching entries', async () => {
    const result = await getLifecycleActions('target-stylist', undefined, now);
    expect(query).toHaveBeenCalledTimes(1);
    const sql = query.mock.calls[0]?.[0];
    expect(sql.text).not.toContain('target-stylist');
    expect(sql.values).toContain('target-stylist');
    expect(sql.text).toContain('LEFT JOIN LATERAL');
    expect(result.actions[0]?.attribution?.messageId).toBe('last-mail');
  });
  it('keeps the query count constant for a full page and preserves its total-order cursor', async () => {
    query.mockResolvedValue(
      Array.from({ length: 50 }, (_, index) => ({
        ...row,
        id: `action-${index}`,
      }))
    );
    const result = await getLifecycleActions(
      'target-stylist',
      'owner-cursor',
      now
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0].values).toContain('owner-cursor');
    expect(result.nextCursor).toBe('action-49');
  });
  it('never invents attribution when no preceding matching entry exists', async () => {
    query.mockResolvedValue([
      {
        id: 'action',
        accountId: 'target-account',
        occurredAt: now,
        entryId: null,
      },
    ]);
    expect(
      (await getLifecycleActions('target-stylist', undefined, now)).actions[0]
        ?.attribution
    ).toBeNull();
  });
});
