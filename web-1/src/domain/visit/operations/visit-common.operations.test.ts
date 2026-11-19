/**
 * requireVisitAccess_IO unit tests — the shared write-gate for the client card.
 *
 * Drives DB_CLIENT.use through the global setup proxy (mockDb), calling the op
 * DIRECTLY. Locks in the retention read/write SYMMETRY fix: the read path
 * (getClientVisits_IO → buildVisitWhere) hides visits older than the plan window,
 * so the write gate MUST reject them too — otherwise update-note/add-photo/remove-photo
 * become a read-oracle for retention-gated content. Plus the plan-lock, not-found and
 * pairing gates that guard every visit mutation.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { requireVisitAccess_IO } from './visit-common.operations';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';

const STYLIST_ACCOUNT_ID = 'acc_test_0000000000000001';
const CLIENT_USER_ID = 'usr_test_0000000000000001';
const VISIT_ID = 'vis_test_0000000000000001';
const DAY_MS = 24 * 60 * 60 * 1000;

const mockVisitAndPairing = ({
  visitDate,
  pairing,
}: {
  visitDate: Date | null;
  pairing: { id: string } | null;
}) => {
  mockDb({
    visitRecord: {
      findFirst: vi.fn(async () =>
        visitDate === null
          ? null
          : {
              id: VISIT_ID,
              client_user_id: CLIENT_USER_ID,
              visit_date: visitDate,
            }
      ),
    },
    clientStylistPair: {
      findFirst: vi.fn(async () => pairing),
    },
  });
};

describe('requireVisitAccess_IO — client-card write gate', () => {
  it('PRO (90d): grants access to a visit inside the retention window', async () => {
    mockVisitAndPairing({ visitDate: new Date(), pairing: { id: 'pair_1' } });

    const result = await requireVisitAccess_IO({
      visit_id: VISIT_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_pricing_plan: PricingPlanValue.PRO,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.client_user_id).toBe(CLIENT_USER_ID);
    }
  });

  it('PRO (90d): rejects a visit OUTSIDE the retention window with VISIT_NOT_FOUND (read/write symmetry)', async () => {
    mockVisitAndPairing({
      visitDate: new Date(Date.now() - 200 * DAY_MS),
      pairing: { id: 'pair_1' },
    });

    const result = await requireVisitAccess_IO({
      visit_id: VISIT_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_pricing_plan: PricingPlanValue.PRO,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VISIT_NOT_FOUND');
    }
  });

  it('STUDIO (full history, retention -1): grants access to a very old visit', async () => {
    mockVisitAndPairing({
      visitDate: new Date(Date.now() - 5000 * DAY_MS),
      pairing: { id: 'pair_1' },
    });

    const result = await requireVisitAccess_IO({
      visit_id: VISIT_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_pricing_plan: PricingPlanValue.STUDIO,
    });

    expect(result.success).toBe(true);
  });

  it('FREE: rejects with CLIENT_CARD_PLAN_LOCKED before any DB read', async () => {
    const visitFind = vi.fn(async () => null);
    mockDb({
      visitRecord: { findFirst: visitFind },
      clientStylistPair: { findFirst: vi.fn(async () => null) },
    });

    const result = await requireVisitAccess_IO({
      visit_id: VISIT_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_pricing_plan: PricingPlanValue.FREE,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('CLIENT_CARD_PLAN_LOCKED');
    }
    expect(visitFind).not.toHaveBeenCalled();
  });

  it('rejects a non-existent visit with VISIT_NOT_FOUND', async () => {
    mockVisitAndPairing({ visitDate: null, pairing: { id: 'pair_1' } });

    const result = await requireVisitAccess_IO({
      visit_id: VISIT_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_pricing_plan: PricingPlanValue.PRO,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VISIT_NOT_FOUND');
    }
  });

  it('rejects when the pairing is not ACTIVE with CLIENT_UNAUTHORIZED_ACCESS', async () => {
    mockVisitAndPairing({ visitDate: new Date(), pairing: null });

    const result = await requireVisitAccess_IO({
      visit_id: VISIT_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_pricing_plan: PricingPlanValue.PRO,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('CLIENT_UNAUTHORIZED_ACCESS');
    }
  });
});
