/**
 * getMyPairs_IO / getPendingPairRequests_IO — D1 phantom slots + D2 hidden-request mute.
 *
 * Pins the server-side mask and the Prisma WHERE (captured call args). The mock
 * returns only rows the WHERE would match — unpaid-but-live stylists are excluded
 * by construction, not by a second JS filter.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  getMyPairs_IO,
  getPendingPairRequests_IO,
} from './pairing-query.operations';
import {
  AccountStatusValue,
  PairingStatusValue,
} from '@kernel/models/db_models.generated.dto';

const STYLIST_ACCOUNT_ID = 'acc_test_0000000000000001';
const CLIENT_USER_ID = 'usr_test_0000000000000002';
const PAIRED_AT_DEAD = new Date('2026-04-01T10:00:00.000Z');
const PAIRED_AT_LIVE = new Date('2026-05-01T10:00:00.000Z');

type FindManyArgs = {
  where: Record<string, unknown>;
  include?: Record<string, unknown>;
};

const findManyArgs = (findMany: ReturnType<typeof vi.fn>): FindManyArgs =>
  findMany.mock.calls[0]?.[0] as FindManyArgs;

describe('getMyPairs_IO — stylist branch (phantom client slot)', () => {
  it('keeps the inactive client row, masks name/email, leaves user_id, and does not filter client_user.is_active', async () => {
    const findMany = vi.fn(async () => [
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
    ]);
    mockDb({ clientStylistPair: { findMany } });

    const result = await getMyPairs_IO({
      current_user_id: 'usr_stylist_00000000001',
      current_stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result).toEqual({
      success: true,
      data: {
        pairs: [
          {
            id: 'pair_dead_client',
            user_id: 'usr_dead_client',
            name: '',
            email: '',
            paired_at: PAIRED_AT_DEAD,
            counterpart_inactive: true,
          },
          {
            id: 'pair_live_client',
            user_id: 'usr_live_client',
            name: 'Ala',
            email: 'ala@example.com',
            paired_at: PAIRED_AT_LIVE,
            counterpart_inactive: false,
          },
        ],
        nextCursor: null,
      },
    });

    const { where, include } = findManyArgs(findMany);
    expect(where).toEqual({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      status: PairingStatusValue.ACTIVE,
    });
    expect(where).not.toHaveProperty('client_user');
    expect(JSON.stringify(where)).not.toContain('is_active');
    expect(
      (include as { client_user: { select: { is_active: boolean } } })
        .client_user.select.is_active
    ).toBe(true);
  });
});

describe('getMyPairs_IO — client branch (phantom stylist slot)', () => {
  it('keeps the dead-user stylist masked, leaves ACTIVE unmasked, and WHERE.OR has both arms', async () => {
    const findMany = vi.fn(async () => [
      {
        id: 'pair_dead_stylist',
        client_user_id: CLIENT_USER_ID,
        stylist_account_id: 'acc_dead_stylist',
        paired_at: PAIRED_AT_DEAD,
        stylist_account: {
          account_id: 'acc_dead_stylist',
          display_name: 'Martwe Studio',
          business_name: 'Ghost Nails',
          address_city: 'Warszawa',
          created_by_user: {
            image: 'https://cdn.example/ghost.jpg',
            is_active: false,
          },
        },
      },
      {
        id: 'pair_live_stylist',
        client_user_id: CLIENT_USER_ID,
        stylist_account_id: 'acc_live_stylist',
        paired_at: PAIRED_AT_LIVE,
        stylist_account: {
          account_id: 'acc_live_stylist',
          display_name: 'Ola Nails',
          business_name: 'Ola Studio',
          address_city: 'Kraków',
          created_by_user: {
            image: 'https://cdn.example/ola.jpg',
            is_active: true,
          },
        },
      },
    ]);
    mockDb({ clientStylistPair: { findMany } });

    const result = await getMyPairs_IO({
      current_user_id: CLIENT_USER_ID,
    });

    expect(result).toEqual({
      success: true,
      data: {
        pairs: [
          {
            id: 'pair_dead_stylist',
            account_id: 'acc_dead_stylist',
            display_name: '',
            business_name: null,
            address_city: null,
            avatar_url: null,
            paired_at: PAIRED_AT_DEAD,
            counterpart_inactive: true,
          },
          {
            id: 'pair_live_stylist',
            account_id: 'acc_live_stylist',
            display_name: 'Ola Nails',
            business_name: 'Ola Studio',
            address_city: 'Kraków',
            avatar_url: 'https://cdn.example/ola.jpg',
            paired_at: PAIRED_AT_LIVE,
            counterpart_inactive: false,
          },
        ],
        nextCursor: null,
      },
    });

    const { where } = findManyArgs(findMany);
    expect(where).toEqual({
      client_user_id: CLIENT_USER_ID,
      status: PairingStatusValue.ACTIVE,
      OR: [
        { stylist_account: { account_status: AccountStatusValue.ACTIVE } },
        { stylist_account: { created_by_user: { is_active: false } } },
      ],
    });
    // Live-but-unpaid (EXPIRING/EXPIRED, created_by_user still active) matches
    // neither OR arm — the mock therefore never returns such a row.
    const orJson = JSON.stringify(where.OR);
    expect(orJson).not.toContain('EXPIRING');
    expect(orJson).not.toContain('EXPIRED');
    expect(orJson).not.toContain(AccountStatusValue.NOT_ACTIVE);
  });
});

describe('getPendingPairRequests_IO — D2 hide = mute', () => {
  it('WHERE includes stylist_hidden_at: null and client_user.is_active: true', async () => {
    const findMany = vi.fn(async () => []);
    mockDb({ clientStylistPair: { findMany } });

    const result = await getPendingPairRequests_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result).toEqual({ success: true, data: { requests: [] } });
    expect(findManyArgs(findMany).where).toEqual({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      status: PairingStatusValue.PENDING,
      client_user: { is_active: true },
      stylist_hidden_at: null,
    });
  });
});
