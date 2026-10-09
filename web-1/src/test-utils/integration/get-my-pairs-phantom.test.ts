/**
 * Integration-handler — GET pairing/get-my-pairs (D1 phantom client slot).
 *
 * Stylist list keeps the inactive-client pair and masks identity at the HTTP
 * envelope (counterpart_inactive + empty name/email, user_id kept).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import handler from '../../pages/api/v1/pairing/get-my-pairs/index';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import { makeCurrentUserOutput, makeStylistCurrentUser } from '../fixtures';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

const PAIRED_AT_DEAD = new Date('2026-04-01T10:00:00.000Z');
const PAIRED_AT_LIVE = new Date('2026-05-01T10:00:00.000Z');

describe('GET /api/v1/pairing/get-my-pairs (D1 phantom pair)', () => {
  beforeEach(() => {
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    __setPermission(true);
  });

  it('stylist with one active + one inactive client → 200, inactive row masked', async () => {
    mockDb({
      clientStylistPair: {
        findMany: async () => [
          {
            id: 'pair_dead_client',
            client_user_id: 'usr_dead_client',
            paired_at: PAIRED_AT_DEAD,
            client_user: {
              id: 'usr_dead_client',
              email: 'ghost@example.com',
              name: 'Ghost Client',
              is_active: false,
            },
          },
          {
            id: 'pair_live_client',
            client_user_id: 'usr_live_client',
            paired_at: PAIRED_AT_LIVE,
            client_user: {
              id: 'usr_live_client',
              email: 'ala@example.com',
              name: 'Ala',
              is_active: true,
            },
          },
        ],
      },
    });

    const { status, event, data } = await mockApiHandler<{
      pairs: Array<{
        id: string;
        user_id: string;
        name: string;
        email: string;
        paired_at: string;
        counterpart_inactive: boolean;
      }>;
      nextCursor: string | null;
    }>(handler, { method: 'GET' });

    expect(status).toBe(200);
    expect(event).toBe(APP_EVENTS.INFO.PAIRING.PAIRING_PAIRS_FETCHED);
    expect(data.nextCursor).toBeNull();
    expect(data.pairs).toEqual([
      {
        id: 'pair_dead_client',
        user_id: 'usr_dead_client',
        name: '',
        email: '',
        paired_at: PAIRED_AT_DEAD.toISOString(),
        counterpart_inactive: true,
      },
      {
        id: 'pair_live_client',
        user_id: 'usr_live_client',
        name: 'Ala',
        email: 'ala@example.com',
        paired_at: PAIRED_AT_LIVE.toISOString(),
        counterpart_inactive: false,
      },
    ]);
  });
});
