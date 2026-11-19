import { pinGalleryRecord_IO } from '@domain/gallery/operations/gallery-pin.operations';
import { describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../test-utils/mockApiHandler';
import { activeSalonMembershipFixture } from '../../test-utils/salon-plan.fixture';
import { resolveEffectivePlan_IO } from './effective-plan.resolver';
import { respondPairRequest_IO } from '@domain/pairing/operations/pair-request.operations';
import { getClientVisits_IO } from '@domain/visit/operations/visit-record.operations';
import { getClientCrmNote_IO } from '@domain/client/operations/client-crm-note.operations';

const account = 'member-account';
const client = 'client';
const setup = () => {
  let active = true;
  let countCall = 0;
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const findMany = vi.fn(async () => []);
  mockDb({
    freeEmailEnrollment: { updateMany: async () => ({ count: 1 }) },
    emailLifecycleAction: {
      create: async () => ({ id: 'receipt', occurredAt: new Date() }),
    },
    staffMember: {
      findMany: async () =>
        active ? activeSalonMembershipFixture('STUDIO') : [],
    },
    clientStylistPair: {
      findFirst: async () => ({
        id: 'pair',
        client_user_id: client,
        crm_note: 'Existing note',
        crm_note_updated_at: null,
      }),
      count: async () => [0, 100, 1][countCall++] ?? 0,
      updateMany,
    },
    visitRecord: { findMany },
    sessionContainer: { findMany: vi.fn(async () => []) },
    galleryRecord: {
      findUnique: async () => ({
        created_by_account_id: account,
        is_pinned: false,
        is_hidden: false,
      }),
      count: async () => 10,
      aggregate: async () => ({ _max: { pinned_position: 9 } }),
      updateMany,
    },
  });
  return {
    updateMany,
    findMany,
    leave: () => {
      active = false;
      countCall = 0;
    },
  };
};
const plan = async () =>
  (await resolveEffectivePlan_IO({ userId: 'member', ownPlan: 'FREE' }))
    .effective_pricing_plan;

describe('effective membership reaches real client and history gates', () => {
  it('member on own Free pins above Free cap using Studio entitlement', async () => {
    const scenario = setup();
    const result = await pinGalleryRecord_IO({
      gallery_record_id: 'record',
      stylist_account_id: account,
      pricing_plan: await plan(),
    });
    expect(result.success).toBe(true);
    expect(scenario.updateMany).toHaveBeenCalledOnce();
  });
  it('Studio member accepts a client above Free cap; leaving restores cap', async () => {
    const scenario = setup();
    const args = {
      stylist_account_id: account,
      stylist_user_id: 'member',
      pair_id: 'pair',
      action: 'ACCEPT' as const,
    };
    expect(
      (
        await respondPairRequest_IO({
          ...args,
          stylist_pricing_plan: await plan(),
        })
      ).success
    ).toBe(true);
    expect(scenario.updateMany).toHaveBeenCalledOnce();
    scenario.leave();
    const fallback = await respondPairRequest_IO({
      ...args,
      stylist_pricing_plan: await plan(),
    });
    expect(fallback.success).toBe(false);
    if (!fallback.success) {
      expect(fallback.error.type).toBe('PAIRING_LIMIT_REACHED');
    }
    expect(scenario.updateMany).toHaveBeenCalledOnce();
  });
  it('member reads full history; leaving restores Free without deleting anything', async () => {
    const scenario = setup();
    const args = { stylist_account_id: account, client_user_id: client };
    const result = await getClientVisits_IO({
      ...args,
      stylist_pricing_plan: await plan(),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.historyAccess.canViewHistory).toBe(true);
    }
    expect(scenario.findMany).toHaveBeenCalledOnce();
    scenario.leave();
    const fallback = await getClientVisits_IO({
      ...args,
      stylist_pricing_plan: await plan(),
    });
    expect(fallback.success).toBe(true);
    if (fallback.success) {
      expect(fallback.data.historyAccess.canViewHistory).toBe(false);
    }
    expect(scenario.findMany).toHaveBeenCalledOnce();
  });
  it('CRM feature is inherited and revoked without removing the stored note', async () => {
    const scenario = setup();
    const args = { stylist_account_id: account, client_user_id: client };
    const result = await getClientCrmNote_IO({
      ...args,
      stylist_pricing_plan: await plan(),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note).toBe('Existing note');
    }
    scenario.leave();
    const fallback = await getClientCrmNote_IO({
      ...args,
      stylist_pricing_plan: await plan(),
    });
    expect(fallback.success).toBe(false);
    if (!fallback.success) {
      expect(fallback.error.type).toBe('CLIENT_CARD_PLAN_LOCKED');
    }
  });
});
