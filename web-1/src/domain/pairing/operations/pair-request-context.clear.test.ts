import { describe, expect, it, vi } from 'vitest';
import { TIME } from '@kernel/application/constants.config';
import { AccountStatusValue } from '@kernel/models/db_models.generated.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  createPairRequest_IO,
  cancelPairRequest_IO,
  respondPairRequest_IO,
} from './pair-request.operations';
import { claimPairingSession_IO } from './pairing-session.operations';
import { getPendingPairRequests_IO } from './pairing-query.operations';
import {
  CLIENT_USER_ID,
  PAIR_ID,
  STYLIST_ACCOUNT_ID,
  mockCreateScenario,
} from './pair-request.test-fixtures';

vi.mock('@app/pricing/plan-config.cache', () => ({
  getPlanConfig: vi.fn(async () => ({ max_paired_clients: 10 })),
}));

vi.mock('@app/pricing/effective-plan.resolver', () => ({
  resolveEffectivePlan_IO: vi.fn(async () => ({
    effective_pricing_plan: 'FREE',
  })),
}));

vi.mock('@domain/email/lifecycle-connection.receipt', () => ({
  confirmLifecycleConnection: vi.fn(async () => ({ id: 'receipt' })),
}));

describe('pair request place and note', () => {
  it('stores trimmed place and note on a new request', async () => {
    const { create } = mockCreateScenario();
    await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      place: '  Kraków, Podgórze  ',
      note: 'czwartek 15:00',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          request_place: 'Kraków, Podgórze',
          request_note: 'czwartek 15:00',
        }),
      })
    );
  });

  it('overwrites place and note when a revoked request is sent again', async () => {
    const { updateMany } = mockCreateScenario({
      existingPair: {
        id: PAIR_ID,
        status: 'REVOKED',
        revoked_by: 'CLIENT',
        paired_at: new Date(Date.now() - 2 * TIME.MS_PER_HOUR),
      },
    });
    await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      place: 'Gdańsk',
      note: null,
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          request_place: 'Gdańsk',
          request_note: null,
        }),
      })
    );
  });

  it.each([true, false])(
    'clears context on withdrawal and keeps a started conversation writable (%s)',
    async started => {
      const updateMany = vi.fn(async () => ({ count: 1 }));
      const pairedAt = new Date('2026-10-01T12:00:00Z');
      mockDb({
        clientStylistPair: {
          findFirst: async () => ({
            id: PAIR_ID,
            paired_at: pairedAt,
            last_pair_request_at: null,
            messages: started ? [{ id: 'message-1' }] : [],
          }),
          updateMany,
        },
      });
      const result = await cancelPairRequest_IO({
        client_user_id: CLIENT_USER_ID,
        stylist_account_id: STYLIST_ACCOUNT_ID,
      });
      expect(result).toMatchObject({ success: true, data: { success: true } });
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: started ? 'CONTACT' : 'REVOKED',
            last_pair_request_at: pairedAt,
            request_place: null,
            request_note: null,
          }),
        })
      );
    }
  );

  it('clears place and note on accept and on decline', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const update = vi.fn(async () => ({ id: PAIR_ID }));
    mockDb({
      freeEmailEnrollment: { updateMany: async () => ({ count: 0 }) },
      emailLifecycleAction: {
        create: async () => ({ id: 'receipt', occurredAt: new Date() }),
      },
      clientStylistPair: {
        findFirst: async () => ({
          id: PAIR_ID,
          client_user_id: CLIENT_USER_ID,
        }),
        count: async () => 0,
        updateMany,
        update,
      },
    });
    await respondPairRequest_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_user_id: 'owner',
      stylist_pricing_plan: PricingPlanValue.FREE,
      pair_id: PAIR_ID,
      action: 'ACCEPT',
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ACTIVE',
          request_place: null,
          request_note: null,
        }),
      })
    );

    await respondPairRequest_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_user_id: 'owner',
      stylist_pricing_plan: PricingPlanValue.FREE,
      pair_id: PAIR_ID,
      action: 'DECLINE',
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          request_place: null,
          request_note: null,
        }),
      })
    );
  });

  it('clears place and note when a QR claim activates the pair', async () => {
    const upsert = vi.fn(async () => ({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      paired_at: new Date(),
    }));
    mockDb({
      pairingSession: {
        findUnique: async () => ({
          id: 'sess',
          stylist_account_id: STYLIST_ACCOUNT_ID,
          claimed_by_client_user_id: null,
          expires_at: new Date(Date.now() + 60_000),
          revoked_at: null,
        }),
        updateMany: async () => ({ count: 1 }),
      },
      stylistAccount: {
        findUnique: async () => ({
          pricing_plan: PricingPlanValue.FREE,
          created_by_user_id: 'owner',
          display_name: 'Ola',
          account_status: AccountStatusValue.ACTIVE,
        }),
      },
      clientStylistPair: {
        findFirst: async () => null,
        count: async () => 0,
        upsert,
      },
      user: {
        findUnique: async () => ({ email: 'ola@salon.pl', name: 'Ola' }),
      },
    });
    const result = await claimPairingSession_IO({
      token: 'token-1',
      client_user_id: CLIENT_USER_ID,
    });
    expect(result.success).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: 'ACTIVE',
          request_place: null,
          request_note: null,
        }),
      })
    );
  });

  it('returns the client photo, place and note on the pending list', async () => {
    const when = new Date('2026-10-01T12:00:00.000Z');
    mockDb({
      clientStylistPair: {
        findMany: async () => [
          {
            id: PAIR_ID,
            paired_at: when,
            request_place: 'Kraków, Podgórze',
            request_note: 'czwartek 15:00',
            client_user: {
              name: 'Anna',
              image: 'https://example.com/anna.jpg',
            },
          },
        ],
      },
    });
    const result = await getPendingPairRequests_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requests[0]).toMatchObject({
        pair_id: PAIR_ID,
        name: 'Anna',
        avatar_url: 'https://example.com/anna.jpg',
        place: 'Kraków, Podgórze',
        note: 'czwartek 15:00',
        requested_at: when,
      });
    }
  });
});
