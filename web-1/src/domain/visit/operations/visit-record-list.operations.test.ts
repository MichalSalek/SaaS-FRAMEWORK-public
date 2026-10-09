/**
 * getClientVisits_IO — kontrakt paginacji karty klientki (cursor + take).
 *
 * Seam najświeższy w domenie: front (useClientVisits, infinite-query) czyta
 * `nextCursor` z każdej strony i podaje go z powrotem. Locks in: hasMore przez
 * take+1, nextCursor = id ostatniej pozycji STRONY (nie rekordu-nadmiarki),
 * klamra take do sufitu, cursor spoza scope pary = VALIDATION_ERROR (bez
 * existence-oracle), FREE = pusta lista + historyAccess bez dotykania listy,
 * para nieaktywna = CLIENT_UNAUTHORIZED_ACCESS przed czymkolwiek.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { getClientVisits_IO } from './visit-record.operations';
import { VISIT_LIST_MAX_TAKE } from './visit-common.operations';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { VisitRecordSourceValue } from '@kernel/models/db_models.generated.dto';

const STYLIST_ACCOUNT_ID = 'acc_test_0000000000000001';
const CLIENT_USER_ID = 'usr_test_0000000000000001';
// Kursor przechodzi isValidCursorFormat (^[a-z0-9]{20,40}$) — id wizyt to cuid.
const visitId = (n: number) => `cvisit${String(n).padStart(19, '0')}`;

const dbVisit = (n: number) => ({
  id: visitId(n),
  client_user_id: CLIENT_USER_ID,
  visit_date: new Date(Date.UTC(2026, 0, n)),
  service_note: null,
  source: VisitRecordSourceValue.MANUAL,
  session_id: null,
  created_at: new Date(Date.UTC(2026, 0, n)),
  result_photos: [],
});

const mockListScenario = ({
  pairActive = true,
  cursorRowExists = true,
  rows = [] as ReturnType<typeof dbVisit>[],
} = {}) => {
  const findMany = vi.fn(async (_args: { take: number }) => rows);
  const cursorCheck = vi.fn(async () =>
    cursorRowExists ? { id: 'any' } : null
  );
  mockDb({
    clientStylistPair: {
      findFirst: vi.fn(async () => (pairActive ? { id: 'pair_1' } : null)),
    },
    visitRecord: { findFirst: cursorCheck, findMany },
  });
  return { findMany, cursorCheck };
};

describe('getClientVisits_IO — paginacja kursorem', () => {
  it('pierwsza strona z nadmiarem: take pozycji + nextCursor = id OSTATNIEJ pozycji strony', async () => {
    const { findMany } = mockListScenario({
      rows: [dbVisit(3), dbVisit(2), dbVisit(1)],
    });
    const result = await getClientVisits_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      client_user_id: CLIENT_USER_ID,
      stylist_pricing_plan: PricingPlanValue.STUDIO,
      take: 2,
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.visits.map(v => v.id)).toEqual([visitId(3), visitId(2)]);
    expect(result.data.nextCursor).toBe(visitId(2));
    expect(findMany.mock.calls[0]?.[0]?.take).toBe(3);
    expect(result.data.historyAccess.canViewHistory).toBe(true);
  });

  it('ostatnia strona: rows <= take → nextCursor null', async () => {
    mockListScenario({ rows: [dbVisit(2), dbVisit(1)] });
    const result = await getClientVisits_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      client_user_id: CLIENT_USER_ID,
      stylist_pricing_plan: PricingPlanValue.STUDIO,
      take: 2,
    });
    expect(result.success && result.data.nextCursor).toBeNull();
  });

  it('take ponad sufit → klamra do VISIT_LIST_MAX_TAKE (+1 na hasMore)', async () => {
    const { findMany } = mockListScenario();
    await getClientVisits_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      client_user_id: CLIENT_USER_ID,
      stylist_pricing_plan: PricingPlanValue.STUDIO,
      take: 999,
    });
    expect(findMany.mock.calls[0]?.[0]?.take).toBe(VISIT_LIST_MAX_TAKE + 1);
  });

  it('kursor w złym formacie → VALIDATION_ERROR bez zapytania o listę', async () => {
    const { findMany, cursorCheck } = mockListScenario();
    const result = await getClientVisits_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      client_user_id: CLIENT_USER_ID,
      stylist_pricing_plan: PricingPlanValue.STUDIO,
      cursor: 'not-a-cursor!',
    });
    expect(!result.success && result.error.type).toBe('VALIDATION_ERROR');
    expect(cursorCheck).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('kursor spoza scope pary (cudzy albo poza oknem retencji) → ten sam VALIDATION_ERROR', async () => {
    const { findMany } = mockListScenario({ cursorRowExists: false });
    const result = await getClientVisits_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      client_user_id: CLIENT_USER_ID,
      stylist_pricing_plan: PricingPlanValue.STUDIO,
      cursor: visitId(9),
    });
    expect(!result.success && result.error.type).toBe('VALIDATION_ERROR');
    expect(findMany).not.toHaveBeenCalled();
  });

  it('poprawny kursor → findMany z cursor+skip:1', async () => {
    const { findMany } = mockListScenario({ rows: [dbVisit(1)] });
    const result = await getClientVisits_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      client_user_id: CLIENT_USER_ID,
      stylist_pricing_plan: PricingPlanValue.STUDIO,
      cursor: visitId(2),
    });
    expect(result.success).toBe(true);
    const args = findMany.mock.calls[0]?.[0] as {
      cursor?: { id: string };
      skip?: number;
    };
    expect(args.cursor).toEqual({ id: visitId(2) });
    expect(args.skip).toBe(1);
  });

  it('plan FREE: pusta lista + historyAccess.isLocked, lista NIE jest odpytywana', async () => {
    const { findMany } = mockListScenario();
    const result = await getClientVisits_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      client_user_id: CLIENT_USER_ID,
      stylist_pricing_plan: PricingPlanValue.FREE,
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.visits).toEqual([]);
    expect(result.data.nextCursor).toBeNull();
    expect(result.data.historyAccess.isLocked).toBe(true);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('para nieaktywna → CLIENT_UNAUTHORIZED_ACCESS przed planem i listą', async () => {
    const { findMany } = mockListScenario({ pairActive: false });
    const result = await getClientVisits_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      client_user_id: CLIENT_USER_ID,
      stylist_pricing_plan: PricingPlanValue.FREE,
    });
    expect(!result.success && result.error.type).toBe(
      'CLIENT_UNAUTHORIZED_ACCESS'
    );
    expect(findMany).not.toHaveBeenCalled();
  });
});
