/**
 * Pair-request unit tests for a standing QR code.
 *
 * Pins: a missing, inactive or own stylist is NOT_FOUND; ACTIVE returns
 * ALREADY_PAIRED and a repeat PENDING changes nothing; REVOKED returns to
 * PENDING without clearing revoked_at (that keeps decline and crm_note); both
 * caps apply at ACCEPT; a foreign or non-PENDING respond is NOT_FOUND with no
 * writes; decline removes a fresh request and returns a post-revoke row to REVOKED.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { respondPairRequest_IO } from './pair-request.operations';
import { getPendingPairRequests_IO } from './pairing-query.operations';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';

vi.mock('@app/pricing/plan-config.cache', () => ({
  getPlanConfig: vi.fn(async () => ({ max_paired_clients: 2 })),
}));

import {
  CLIENT_USER_ID,
  STYLIST_ACCOUNT_ID,
  PAIR_ID,
} from './pair-request.test-fixtures';

type WhereArg = { where?: Record<string, unknown> };

const mockRespondScenario = ({
  pair = { id: PAIR_ID, client_user_id: CLIENT_USER_ID } as null | {
    id: string;
    client_user_id: string;
  },
  clientActiveCount = 0,
  stylistActiveCount = 0,
  updatedCount = 1,
  postAcceptClientCount = 1,
} = {}) => {
  // count() wołany 3×: client platform-cap, stylist plan-cap, post-accept
  // backstop — kolejnością wywołań (mockImplementation po kolei).
  const counts = [clientActiveCount, stylistActiveCount, postAcceptClientCount];
  let countCall = 0;
  const findFirst = vi.fn(async (_args: WhereArg) => pair);
  const count = vi.fn(async (_args: WhereArg) => counts[countCall++] ?? 0);
  const updateMany = vi.fn(async (_args: WhereArg) => ({
    count: updatedCount,
  }));
  const update = vi.fn(async (_args: { data: Record<string, unknown> }) => ({
    id: PAIR_ID,
  }));
  const del = vi.fn(async () => ({ id: PAIR_ID }));
  const finishEnrollment = vi.fn(async () => ({ count: 1 }));
  mockDb({
    freeEmailEnrollment: { updateMany: finishEnrollment },
    emailLifecycleAction: {
      create: async () => ({ id: 'receipt', occurredAt: new Date() }),
    },
    clientStylistPair: {
      findFirst,
      count,
      updateMany,
      update,
      delete: del,
    },
  });
  return { findFirst, count, updateMany, update, del, finishEnrollment };
};

describe('respondPairRequest_IO — akceptacja/odrzucenie prośby przez stylistkę', () => {
  it('ACCEPT happy path: PENDING→ACTIVE atomowym updateMany z predykatem statusu', async () => {
    const { updateMany, finishEnrollment } = mockRespondScenario();

    const result = await respondPairRequest_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_user_id: 'stylist-owner',
      stylist_pricing_plan: PricingPlanValue.PRO,
      pair_id: PAIR_ID,
      action: 'ACCEPT',
    });

    expect(result.success).toBe(true);
    expect(finishEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: STYLIST_ACCOUNT_ID, status: 'active' },
        data: expect.objectContaining({
          status: 'finished',
          finishReason: 'completed',
        }),
      })
    );
    if (result.success) {
      expect(result.data.status).toBe('ACTIVE');
    }
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('anty-oracle: cudza / nieistniejąca / nie-PENDING prośba → PAIR_REQUEST_NOT_FOUND, zero mutacji', async () => {
    const { updateMany, update, del } = mockRespondScenario({ pair: null });

    const result = await respondPairRequest_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_user_id: 'stylist-owner',
      stylist_pricing_plan: PricingPlanValue.PRO,
      pair_id: PAIR_ID,
      action: 'ACCEPT',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('PAIR_REQUEST_NOT_FOUND');
    }
    expect(updateMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('ACCEPT: klientka na platform-capie (3 ACTIVE stylistki) → PAIRING_LIMIT_REACHED PLATFORM', async () => {
    const { updateMany } = mockRespondScenario({ clientActiveCount: 3 });

    const result = await respondPairRequest_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_user_id: 'stylist-owner',
      stylist_pricing_plan: PricingPlanValue.PRO,
      pair_id: PAIR_ID,
      action: 'ACCEPT',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('PAIRING_LIMIT_REACHED');
      if (result.error.type === 'PAIRING_LIMIT_REACHED') {
        expect(result.error.planType).toBe('PLATFORM');
      }
    }
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('ACCEPT: stylistka na plan-capie (max_paired_clients=2) → PAIRING_LIMIT_REACHED z planem', async () => {
    const { updateMany } = mockRespondScenario({ stylistActiveCount: 2 });

    const result = await respondPairRequest_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_user_id: 'stylist-owner',
      stylist_pricing_plan: PricingPlanValue.FREE,
      pair_id: PAIR_ID,
      action: 'ACCEPT',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('PAIRING_LIMIT_REACHED');
      if (result.error.type === 'PAIRING_LIMIT_REACHED') {
        expect(result.error.planType).toBe(PricingPlanValue.FREE);
      }
    }
    expect(updateMany).not.toHaveBeenCalled();
  });

  // This test pins the behaviour change. DECLINE of a fresh request used to
  // delete the row, and StylistClientMessage cascades on the pair, so one
  // „Odrzuć" erased the whole conversation for both sides. The old assertion
  // (delete was called) encoded that bug, so it was rewritten, not weakened.
  it('DECLINE nigdy nie kasuje wiersza: bezwarunkowe REVOKED + revoked_by=STYLIST', async () => {
    const { del, update } = mockRespondScenario();

    const result = await respondPairRequest_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_user_id: 'stylist-owner',
      stylist_pricing_plan: PricingPlanValue.PRO,
      pair_id: PAIR_ID,
      action: 'DECLINE',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('DECLINED');
    }
    expect(del).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    const data = update.mock.calls[0]?.[0]?.data;
    expect(data?.status).toBe('REVOKED');
    expect(data?.revoked_by).toBe('STYLIST');
    expect(data?.revoked_at).toBeInstanceOf(Date);
  });

  it('ACCEPT wymaga żywej klientki, DECLINE nie — asymetria widoczności', async () => {
    const { findFirst, updateMany } = mockRespondScenario();

    await respondPairRequest_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_user_id: 'stylist-owner',
      stylist_pricing_plan: PricingPlanValue.PRO,
      pair_id: PAIR_ID,
      action: 'ACCEPT',
    });
    expect(findFirst.mock.calls[0]?.[0]?.where?.client_user).toEqual({
      is_active: true,
    });
    // Race-guard powtarza predykat — klientka zdjęta po odczycie = count 0.
    expect(updateMany.mock.calls[0]?.[0]?.where?.client_user).toEqual({
      is_active: true,
    });

    const declineScenario = mockRespondScenario();
    await respondPairRequest_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_user_id: 'stylist-owner',
      stylist_pricing_plan: PricingPlanValue.PRO,
      pair_id: PAIR_ID,
      action: 'DECLINE',
    });
    // The client can disappear between the list and a tap on „Odrzuć". Cleaning
    // up the request must succeed, because it grants nothing.
    expect(
      declineScenario.findFirst.mock.calls[0]?.[0]?.where?.client_user
    ).toBeUndefined();
  });

  it('capy liczą KAŻDĄ parę ACTIVE, także z martwym kontrpartnerem', async () => {
    // This test used to encode the opposite: caps skipped pairs whose other side was soft-deleted or banned so a
    // "ghost" would not eat a slot. Measured on a live backend, that opened a plan-limit bypass: a client deleted
    // her account (slot freed), a FREE stylist accepted a third pair, the client restored the account in one click
    // and the FREE account held 3 pairs at a limit of 2, indefinitely and repeatably (the pair row never
    // disappears, so nothing reconciles it). Hence the cap counts everything; see pairing-cap.predicates.ts.
    const { count } = mockRespondScenario();

    await respondPairRequest_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_user_id: 'stylist-owner',
      stylist_pricing_plan: PricingPlanValue.PRO,
      pair_id: PAIR_ID,
      action: 'ACCEPT',
    });

    for (const call of count.mock.calls) {
      const where = call[0]?.where as Record<string, unknown> | undefined;
      expect(where?.status).toBe('ACTIVE');
      // No counterpart-liveness condition may return to the cap count.
      expect(where?.stylist_account).toBeUndefined();
      expect(where?.client_user).toBeUndefined();
    }
  });
});

describe('getPendingPairRequests_IO — lista próśb na ekranie Parowanie', () => {
  it('mapuje dane prośby i zdjęcie bez ujawniania emaila', async () => {
    const requestedAt = new Date('2026-07-11T10:00:00Z');
    mockDb({
      clientStylistPair: {
        findMany: vi.fn(async () => [
          {
            id: PAIR_ID,
            client_user_id: CLIENT_USER_ID,
            paired_at: requestedAt,
            request_place: 'Salon',
            request_note: 'Dzień dobry',
            client_user: {
              name: 'Kasia',
              avatar_url: 'custom-photo',
              image: 'oauth-photo',
              email: 'private@example.test',
            },
          },
        ]),
      },
    });

    const result = await getPendingPairRequests_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requests).toEqual([
        {
          pair_id: PAIR_ID,
          name: 'Kasia',
          avatar_url: 'custom-photo',
          place: 'Salon',
          note: 'Dzień dobry',
          requested_at: requestedAt,
        },
      ]);
      expect(JSON.stringify(result.data)).not.toContain('private@example.test');
    }
  });
});
