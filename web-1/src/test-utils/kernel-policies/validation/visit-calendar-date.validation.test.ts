import { expect, it } from 'vitest';
import { createManualVisitSchema } from '@kernel/domain/visit/visit.contract-schemas';

it.each(['February 31, 2026', '2026/02/31', '02/31/2026', '2026-02-31'])(
  'rejects an impossible calendar date instead of saving a rolled date: %s',
  visitDate => {
    expect(
      createManualVisitSchema.safeParse({
        client_user_id: 'own-client',
        visit_date: visitDate,
      }).success
    ).toBe(false);
  }
);

it.each(['2026-02-28', '2026-02-28T12:00:00Z', '2026-02-28T12:00:00+02:00'])(
  'preserves valid date and timestamp inputs: %s',
  visitDate => {
    expect(
      createManualVisitSchema.safeParse({
        client_user_id: 'own-client',
        visit_date: visitDate,
      }).success
    ).toBe(true);
  }
);
