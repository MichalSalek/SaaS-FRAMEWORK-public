import { beforeEach, describe, expect, it, vi } from 'vitest';
import planChangeHandler from '../../pages/api/v1/account/plan-change';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import { makeCurrentUserOutput, makeStylistCurrentUser } from '../fixtures';

const { changePaidPlan_IO } = vi.hoisted(() => ({
  changePaidPlan_IO: vi.fn(),
}));

vi.mock('@domain/account/operations/account-plan-change.operations', () => ({
  changePaidPlan_IO,
}));

const QUOTE_ID = '11111111-1111-4111-8111-111111111111';

describe('POST account/plan-change quote forwarding', () => {
  beforeEach(() => {
    __setPermission(true);
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    mockDb({ impersonationBackup: { findFirst: async () => null } });
    changePaidPlan_IO.mockReset();
    changePaidPlan_IO.mockResolvedValue({
      success: true,
      data: { status: 'completed' },
    });
  });

  it('forwards quoteId when the client sends one', async () => {
    const { status } = await mockApiHandler(planChangeHandler, {
      method: 'POST',
      url: '/api/v1/account/plan-change',
      body: {
        targetPlanId: 'PRO_PLUS',
        billingPeriod: 'month',
        quoteId: QUOTE_ID,
      },
    });
    expect(status).toBe(200);
    expect(changePaidPlan_IO).toHaveBeenCalledWith({
      userId: 'usr_test_0000000000000001',
      targetPlanId: 'PRO_PLUS',
      billingPeriod: 'month',
      quoteId: QUOTE_ID,
    });
  });

  it('omits quoteId for a legacy body', async () => {
    const { status } = await mockApiHandler(planChangeHandler, {
      method: 'POST',
      url: '/api/v1/account/plan-change',
      body: { targetPlanId: 'PRO_PLUS', billingPeriod: 'year' },
    });
    expect(status).toBe(200);
    expect(changePaidPlan_IO).toHaveBeenCalledWith({
      userId: 'usr_test_0000000000000001',
      targetPlanId: 'PRO_PLUS',
      billingPeriod: 'year',
    });
  });
});
