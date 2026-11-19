import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: { use: { user: { findUnique } } },
}));
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: vi.fn(),
}));

import {
  acceptsActivityEmail,
  activityEmailsAllowed_IO,
} from './activity-email-consent';

const live = { notifications_enabled: true, is_active: true, deleted_at: null };

describe('acceptsActivityEmail', () => {
  it('needs the switch on AND a live account', () => {
    expect(acceptsActivityEmail(live)).toBe(true);
    expect(
      acceptsActivityEmail({ ...live, notifications_enabled: false })
    ).toBe(false);
    expect(acceptsActivityEmail({ ...live, is_active: false })).toBe(false);
    expect(acceptsActivityEmail({ ...live, deleted_at: new Date() })).toBe(
      false
    );
    expect(acceptsActivityEmail(null)).toBe(false);
    expect(acceptsActivityEmail(undefined)).toBe(false);
  });
});

describe('activityEmailsAllowed_IO', () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it('follows the stored switch', async () => {
    findUnique.mockResolvedValueOnce(live);
    expect(await activityEmailsAllowed_IO('usr_1')).toBe(true);
    findUnique.mockResolvedValueOnce({ ...live, notifications_enabled: false });
    expect(await activityEmailsAllowed_IO('usr_1')).toBe(false);
  });

  it('skips a soft-deleted account even with the switch on', async () => {
    findUnique.mockResolvedValueOnce({
      ...live,
      is_active: false,
      deleted_at: new Date(),
    });
    expect(await activityEmailsAllowed_IO('usr_1')).toBe(false);
  });

  it('fails closed on a missing user or a failed read', async () => {
    findUnique.mockResolvedValueOnce(null);
    expect(await activityEmailsAllowed_IO('usr_1')).toBe(false);
    findUnique.mockRejectedValueOnce(new Error('db down'));
    expect(await activityEmailsAllowed_IO('usr_1')).toBe(false);
  });
});
