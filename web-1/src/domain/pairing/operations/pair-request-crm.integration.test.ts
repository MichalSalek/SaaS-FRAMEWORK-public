import { describe, expect, it, vi } from 'vitest';
import { VISIT_CONFIG } from '@kernel/domain/visit/visit.config';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  respondPairRequest_IO,
  cancelPairRequest_IO,
} from './pair-request.operations';
import { claimPairingSession_IO } from './pairing-session.operations';
import { getClientCrmNote_IO } from '@domain/client/operations/client-crm-note.operations';

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
vi.mock('@app/email-handler/lifecycle/email-locale-batch.resolver', () => ({
  batchResolveLocales: vi.fn(async () => new Map([['owner', 'en']])),
}));

const baseline = `  ${'😀'.repeat(VISIT_CONFIG.CRM_NOTE_MAX)}\r\n`;
const respond = (action: 'ACCEPT' | 'DECLINE' = 'ACCEPT') =>
  respondPairRequest_IO({
    stylist_account_id: 'stylist',
    stylist_user_id: 'owner',
    stylist_pricing_plan: 'FREE',
    pair_id: 'pair',
    action,
  });

function scenario({ cap = false, raceLost = false } = {}) {
  const row = {
    id: 'pair',
    client_user_id: 'client',
    stylist_account_id: 'stylist',
    stylist_account: { created_by_user_id: 'owner' },
    status: 'PENDING',
    paired_at: new Date('2026-10-23T10:00:00.000Z'),
    last_pair_request_at: null,
    messages: [],
    crm_note: baseline,
    crm_note_updated_at: new Date('2026-10-24T12:00:00.000Z'),
    request_place: 'Kraków' as string | null,
    request_note: 'Thursday\n15:00' as string | null,
    important_note: 'Safety note',
  };
  const updateMany = vi.fn(
    async ({ data }: { data: Record<string, unknown> }) => {
      if (raceLost) {
        return { count: 0 };
      }
      Object.assign(row, data);
      return { count: 1 };
    }
  );
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    Object.assign(row, data);
    return row;
  });
  const upsert = vi.fn(
    async ({ update: data }: { update: Record<string, unknown> }) => {
      Object.assign(row, data);
      return row;
    }
  );
  mockDb({
    clientStylistPair: {
      findFirst: async ({ where }: { where: { status?: string } }) =>
        where.status === undefined || where.status === row.status
          ? { ...row }
          : null,
      count: async () => (cap ? 3 : 0),
      updateMany,
      update,
      upsert,
    },
    pairingSession: {
      findUnique: async () => ({
        id: 'session',
        stylist_account_id: 'stylist',
        claimed_by_client_user_id: null,
        revoked_at: null,
        expires_at: new Date(Date.now() + 60_000),
      }),
      updateMany: async () => ({ count: 1 }),
    },
    stylistAccount: {
      findUnique: async () => ({
        created_by_user_id: 'owner',
        pricing_plan: 'FREE',
        account_status: 'ACTIVE',
        display_name: 'Salon',
      }),
    },
    user: {
      findUnique: async () => ({ email: 'owner@example.test', name: 'Owner' }),
    },
  });
  return { row, updateMany, update, upsert };
}

describe('request context retained in stylist CRM on activation', () => {
  it('accepts on Free, preserves the full baseline, and stores before clearing in one update', async () => {
    const { row, updateMany } = scenario();
    expect((await respond()).success).toBe(true);
    expect(row.crm_note).toContain(`${baseline}\n\nClient connection request`);
    expect(row.crm_note).toContain(
      'Approximate location: Kraków\nClient message: Thursday\n15:00'
    );
    expect(row.important_note).toBe('Safety note');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ACTIVE',
          crm_note: row.crm_note,
          crm_note_updated_at: expect.any(Date),
          request_place: null,
          request_note: null,
        }),
      })
    );
    const read = await getClientCrmNote_IO({
      stylist_account_id: 'stylist',
      client_user_id: 'client',
      stylist_pricing_plan: 'FREE',
    });
    expect(read).toMatchObject({
      success: false,
      error: { type: 'CLIENT_CARD_PLAN_LOCKED' },
    });
    const saved = row.crm_note;
    expect((await respond()).success).toBe(false);
    expect(row.crm_note).toBe(saved);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('QR activation of a pending pair preserves context and ACTIVE replay does not append again', async () => {
    const { row, upsert } = scenario();
    expect(
      (
        await claimPairingSession_IO({
          token: 'first',
          client_user_id: 'client',
        })
      ).success
    ).toBe(true);
    expect(row.crm_note).toContain(`${baseline}\n\nClient connection request`);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          crm_note: row.crm_note,
          request_place: null,
          request_note: null,
        }),
      })
    );
    const saved = row.crm_note;
    expect(
      (
        await claimPairingSession_IO({
          token: 'another-valid-code',
          client_user_id: 'client',
        })
      ).success
    ).toBe(true);
    expect(row.crm_note).toBe(saved);
    expect(upsert.mock.calls[1]?.[0].update).not.toHaveProperty('crm_note');
    expect(row.important_note).toBe('Safety note');
  });

  it.each(['DECLINE', 'CANCEL'] as const)(
    '%s clears transient context without copying it',
    async action => {
      const { row } = scenario();
      const result =
        action === 'DECLINE'
          ? await respond(action)
          : await cancelPairRequest_IO({
              client_user_id: 'client',
              stylist_account_id: 'stylist',
            });
      expect(result.success).toBe(true);
      expect(row.crm_note).toBe(baseline);
      expect(row.request_place).toBeNull();
      expect(row.request_note).toBeNull();
    }
  );

  it.each([{ cap: true }, { raceLost: true }])(
    'a failed accept leaves context and CRM intact (%j)',
    async options => {
      const { row } = scenario(options);
      expect((await respond()).success).toBe(false);
      expect(row.crm_note).toBe(baseline);
      expect(row.request_place).toBe('Kraków');
      expect(row.request_note).toBe('Thursday\n15:00');
    }
  );

  it.each(['ACCEPT', 'QR'] as const)(
    '%s advances the retained CRM revision on a same-millisecond import',
    async route => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-24T12:00:00.000Z'));
      try {
        const { row } = scenario();
        const result =
          route === 'ACCEPT'
            ? await respond()
            : await claimPairingSession_IO({
                token: 'same-ms',
                client_user_id: 'client',
              });
        expect(result.success).toBe(true);
        expect(row.crm_note_updated_at.toISOString()).toBe(
          '2026-10-24T12:00:00.001Z'
        );
      } finally {
        vi.useRealTimers();
      }
    }
  );
});
