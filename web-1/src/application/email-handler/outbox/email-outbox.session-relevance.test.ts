import { describe, expect, it, vi } from 'vitest';
import { __setDb } from '../../../test-utils/setup';
import type { OutboxRow } from './email-outbox.policy';

const resolve = vi.hoisted(() => vi.fn(async () => null));
vi.mock('@domain/pairing/salon-access.resolver', () => ({
  resolveSalonAccess_IO: resolve,
}));
vi.mock('@app/email-handler/activity-email-consent', () => ({
  activityEmailsAllowed_IO: vi.fn(async () => true),
}));
import { loadOutboxRelevance } from './email-outbox.relevance';

describe('session shared email relevance', () => {
  it('suppresses a delayed email after derived salon access has ended', async () => {
    __setDb({
      sessionContainer: {
        findFirst: vi.fn(async () => ({
          client_account: { created_by_user_id: 'client' },
        })),
      },
      clientStylistPair: {
        findFirst: vi.fn(async () => ({
          id: 'pair',
          salon_origin_account_id: 'salon',
        })),
      },
    });
    const row = {
      ruleId: 'session-shared',
      userId: 'stylist-user',
      accountId: 'stylist',
      outboxPayload: { vars: { sessionId: 'session' } },
    } as unknown as OutboxRow;
    expect(await loadOutboxRelevance(row)).toBe(false);
  });
});
