import { describe, expect, it } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { processPlanCounts } from './admin-reports.helpers';

describe('processPlanCounts', () => {
  it('returns zero for each plan when the query has no rows', () => {
    expect(processPlanCounts([])).toEqual({
      FREE: 0,
      PRO: 0,
      PRO_PLUS: 0,
      STUDIO: 0,
      SCALE: 0,
    });
  });

  it('preserves the query counts for each plan and fills absent plans with zero', () => {
    expect(
      processPlanCounts([
        { pricing_plan: PricingPlanValue.FREE, _count: { _all: 12 } },
        { pricing_plan: PricingPlanValue.PRO_PLUS, _count: { _all: 3 } },
        { pricing_plan: PricingPlanValue.SCALE, _count: { _all: 1 } },
      ])
    ).toEqual({ FREE: 12, PRO: 0, PRO_PLUS: 3, STUDIO: 0, SCALE: 1 });
  });
});
