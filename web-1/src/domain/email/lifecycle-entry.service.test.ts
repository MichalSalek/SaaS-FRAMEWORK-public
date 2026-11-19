import { beforeEach, describe, expect, it, vi } from 'vitest';
const { findFirst, upsert } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    use: {
      emailLifecycleMessage: { findFirst },
      emailLifecycleEntry: { upsert },
    },
  },
}));
import { recordLifecycleEntry } from './lifecycle-entry.service';
const now = new Date('2026-10-19T10:00:00Z');
const input = {
  messageId: 'message',
  ctaId: 'primary',
  entryId: 'visit',
  interactedAt: now.toISOString(),
};
const message = {
  id: 'message',
  family: 'free',
  ruleId: 'free-first-photo',
  locale: 'pl',
  cohort: 'new',
  provider: 'resend',
};

describe('lifecycle entry owner validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('queries by session owner, accepted age and CTA membership and ignores foreign or old markers', async () => {
    findFirst.mockResolvedValue(null);
    expect(await recordLifecycleEntry('owner', input, now)).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'owner',
          id: input.messageId,
          ctaIds: { has: 'primary' },
          acceptedAt: expect.objectContaining({ not: null, lte: now }),
        }),
      })
    );
  });
  it('reuses the server entry timestamp so a refresh cannot restart the attribution window', async () => {
    findFirst.mockResolvedValue(message);
    const enteredAt = new Date('2026-10-18T10:00:00Z');
    upsert.mockResolvedValue({
      id: 'visit',
      userId: 'owner',
      messageId: 'message',
      ctaId: 'primary',
      createdAt: enteredAt,
    });
    expect(await recordLifecycleEntry('owner', input, now)).toMatchObject({
      entryId: 'visit',
      enteredAt: enteredAt.toISOString(),
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} })
    );
  });
  it('never returns attribution when a forged visit id belongs to a different owner or CTA', async () => {
    findFirst.mockResolvedValue(message);
    upsert.mockResolvedValue({
      id: 'visit',
      userId: 'other',
      messageId: 'message',
      ctaId: 'primary',
      createdAt: now,
    });
    expect(await recordLifecycleEntry('owner', input, now)).toBeNull();
  });
});
