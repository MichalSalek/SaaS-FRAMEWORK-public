/**
 * Moderation report unit tests — createContentReport_IO (report-abuse).
 *
 * Drives DB_CLIENT.use through the global setup proxy (mockDb), calling the op
 * DIRECTLY. Locks in the guard ORDER and scoping contract:
 *
 *  - target existence AND visibility to the reporter (the shared get-by-id gate:
 *    !is_hidden, stylist publicly visible, pinned or ACTIVE pair) collapse into ONE
 *    GALLERY_RECORD_NOT_FOUND, and together with the self-report guard run BEFORE
 *    the Serializable transaction — a rejected report writes NOTHING;
 *  - rate-limit count is scoped to THE REPORTER within a 1h window (5/h cap),
 *    and fires BEFORE the dedup check (no PENDING-probe leak past the limit);
 *  - dedup blocks ONLY a still-PENDING report by this reporter on this record
 *    (re-report after resolve/reject is allowed — admin-moderation-4);
 *  - create is scoped by reporter_id + gallery_record_id, reason passes 1:1
 *    (Prisma enum), unknown/stale reason collapses to OTHER (defensive fallback);
 *  - Serializable loser (40001, adapter-pg DriverAdapterError shape) maps to a
 *    RETRYABLE CONTENT_REPORT_RATE_LIMITED, P2002 to CONTENT_REPORT_DUPLICATE,
 *    anything else to DATABASE_ERROR.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { createContentReport_IO } from './moderation-report.operation';
import {
  AccountStatusValue,
  ContentReportReasonValue,
  PairingStatusValue,
} from '@kernel/models/db_models.generated.dto';
import type { ContentReportReason } from '@kernel/models/moderation/moderation.dto';

const RECORD_ID = 'gr_test_00000000000001';
const REPORTER_ID = 'usr_test_reporter_0001';
const OWNER_USER_ID = 'usr_test_owner_000001';
const REPORT_ID = 'rep_test_0000000000001';
const STYLIST_ACCOUNT_ID = 'acc_test_stylist_00001';

type ReportScenario = {
  recordExists?: boolean;
  ownerUserId?: string;
  isHidden?: boolean;
  isPinned?: boolean;
  accountStatus?: string;
  ownerUserActive?: boolean;
  activePair?: boolean;
  recentCount?: number;
  pendingDuplicate?: boolean;
  createImpl?: (() => Promise<{ id: string }>) | undefined;
};

const mockReportScenario = ({
  recordExists = true,
  ownerUserId = OWNER_USER_ID,
  isHidden = false,
  isPinned = true,
  accountStatus = AccountStatusValue.ACTIVE,
  ownerUserActive = true,
  activePair = false,
  recentCount = 0,
  pendingDuplicate = false,
  createImpl = undefined,
}: ReportScenario = {}) => {
  const galleryFindUnique = vi.fn(async (_arg: unknown) =>
    recordExists
      ? {
          is_hidden: isHidden,
          is_pinned: isPinned,
          created_by_account: {
            account_id: STYLIST_ACCOUNT_ID,
            created_by_user_id: ownerUserId,
            account_status: accountStatus,
            created_by_user: { is_active: ownerUserActive },
          },
        }
      : null
  );
  const pairFindFirst = vi.fn(async (_arg: unknown) =>
    activePair ? { id: 'pair_test_active_0001' } : null
  );
  const count = vi.fn(async (_arg: unknown) => recentCount);
  const findFirst = vi.fn(async (_arg: unknown) =>
    pendingDuplicate ? { id: 'rep_existing_pending' } : null
  );
  const create = vi.fn(
    createImpl ?? (async (_arg: unknown) => ({ id: REPORT_ID }))
  );
  mockDb({
    galleryRecord: { findUnique: galleryFindUnique },
    clientStylistPair: { findFirst: pairFindFirst },
    contentReport: { count, findFirst, create },
  });
  return { galleryFindUnique, pairFindFirst, count, findFirst, create };
};

const callReport = (
  overrides: Partial<Parameters<typeof createContentReport_IO>[0]> = {}
) =>
  createContentReport_IO({
    gallery_record_id: RECORD_ID,
    reporter_id: REPORTER_ID,
    reason: ContentReportReasonValue.SPAM,
    description: undefined,
    ...overrides,
  });

describe('createContentReport_IO — zgłoszenie rekordu galerii', () => {
  it('happy path: create scoped po reporterze i rekordzie, reason 1:1, zwraca report_id', async () => {
    const { count, findFirst, create } = mockReportScenario();

    const result = await callReport({ description: 'obraźliwe treści' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.report_id).toBe(REPORT_ID);
    }

    // Rate-limit count scoped to THE REPORTER within a rolling 1h window.
    const countArg = count.mock.calls[0]?.[0] as unknown as {
      where: { reporter_id: string; created_at: { gte: Date } };
    };
    expect(countArg.where.reporter_id).toBe(REPORTER_ID);
    expect(countArg.where.created_at.gte).toBeInstanceOf(Date);

    // Dedup probe scoped to a still-PENDING report by this reporter on this record.
    const dupArg = findFirst.mock.calls[0]?.[0] as unknown as {
      where: { gallery_record_id: string; reporter_id: string; status: string };
    };
    expect(dupArg.where.gallery_record_id).toBe(RECORD_ID);
    expect(dupArg.where.reporter_id).toBe(REPORTER_ID);
    expect(dupArg.where.status).toBe('PENDING');

    // Create payload: reporter from the session param (never body-controlled here),
    // reason passes through unchanged (valid Prisma enum value).
    const createArg = create.mock.calls[0]?.[0] as unknown as {
      data: {
        gallery_record_id: string;
        reporter_id: string;
        reason: string;
        description: string | null;
      };
    };
    expect(createArg.data.gallery_record_id).toBe(RECORD_ID);
    expect(createArg.data.reporter_id).toBe(REPORTER_ID);
    expect(createArg.data.reason).toBe(ContentReportReasonValue.SPAM);
    expect(createArg.data.description).toBe('obraźliwe treści');
  });

  it('brak description → zapis null (nie undefined/pusty string)', async () => {
    const { create } = mockReportScenario();

    const result = await callReport({ description: undefined });

    expect(result.success).toBe(true);
    const createArg = create.mock.calls[0]?.[0] as unknown as {
      data: { description: string | null };
    };
    expect(createArg.data.description).toBeNull();
  });

  it('nieznany/stale-client reason → defensywny fallback do OTHER', async () => {
    const { create } = mockReportScenario();
    // Stale lowercase client value — the DECISION-documented defensive branch.
    const staleClientReason = 'spam' as unknown as ContentReportReason;

    const result = await callReport({ reason: staleClientReason });

    expect(result.success).toBe(true);
    const createArg = create.mock.calls[0]?.[0] as unknown as {
      data: { reason: string };
    };
    expect(createArg.data.reason).toBe(ContentReportReasonValue.OTHER);
  });

  it('rekord galerii nie istnieje → GALLERY_RECORD_NOT_FOUND, zero zapisów', async () => {
    const { count, findFirst, create } = mockReportScenario({
      recordExists: false,
    });

    const result = await callReport();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('GALLERY_RECORD_NOT_FOUND');
    }
    expect(count).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    [
      'nie-pinowany rekord, brak aktywnej pary (niesparowana / odwołana klientka)',
      { isPinned: false, activePair: false },
    ],
    ['rekord już ukryty przez moderację (is_hidden)', { isHidden: true }],
    [
      'przypięty rekord zbanowanej stylistki (account_status != ACTIVE)',
      { accountStatus: AccountStatusValue.NOT_ACTIVE },
    ],
    [
      'przypięty rekord stylistki z nieaktywnym userem (soft-delete)',
      { ownerUserActive: false },
    ],
  ] as const)(
    'rekord niewidoczny dla zgłaszającej (%s) → ten sam GALLERY_RECORD_NOT_FOUND co nieistniejący, zero zapisów',
    async (_label, scenario) => {
      const { count, findFirst, create } = mockReportScenario(scenario);

      const result = await callReport();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('GALLERY_RECORD_NOT_FOUND');
      }
      expect(count).not.toHaveBeenCalled();
      expect(findFirst).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    }
  );

  it('nie-pinowany rekord + AKTYWNA para → zgłoszenie przechodzi, lookup pary scoped do zgłaszającej', async () => {
    const { pairFindFirst, create } = mockReportScenario({
      isPinned: false,
      activePair: true,
    });

    const result = await callReport();

    expect(result.success).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    const pairArg = pairFindFirst.mock.calls[0]?.[0] as unknown as {
      where: {
        client_user_id: string;
        stylist_account_id: string;
        status: string;
      };
    };
    expect(pairArg.where.client_user_id).toBe(REPORTER_ID);
    expect(pairArg.where.stylist_account_id).toBe(STYLIST_ACCOUNT_ID);
    expect(pairArg.where.status).toBe(PairingStatusValue.ACTIVE);
  });

  it('przypięty rekord widocznej stylistki → zgłoszenie bez lookupu pary', async () => {
    const { pairFindFirst, create } = mockReportScenario();

    const result = await callReport();

    expect(result.success).toBe(true);
    expect(pairFindFirst).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('self-report (reporter == właściciel rekordu) → CONTENT_REPORT_SELF_REPORT przed transakcją', async () => {
    const { count, findFirst, create } = mockReportScenario({
      ownerUserId: REPORTER_ID,
    });

    const result = await callReport();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('CONTENT_REPORT_SELF_REPORT');
    }
    // Guard runs BEFORE the tx — no rate-limit probe, no dedup probe, no insert.
    expect(count).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('5 raportów w oknie 1h → CONTENT_REPORT_RATE_LIMITED {5/5}, bez dedup-probe i bez insertu', async () => {
    const { findFirst, create } = mockReportScenario({ recentCount: 5 });

    const result = await callReport();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('CONTENT_REPORT_RATE_LIMITED');
      if (result.error.type === 'CONTENT_REPORT_RATE_LIMITED') {
        expect(result.error.currentCount).toBe(5);
        expect(result.error.limit).toBe(5);
      }
    }
    expect(findFirst).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('istniejący PENDING duplikat → CONTENT_REPORT_DUPLICATE_PENDING, bez insertu', async () => {
    const { create } = mockReportScenario({ pendingDuplicate: true });

    const result = await callReport();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('CONTENT_REPORT_DUPLICATE_PENDING');
      if (result.error.type === 'CONTENT_REPORT_DUPLICATE_PENDING') {
        expect(result.error.galleryRecordId).toBe(RECORD_ID);
        expect(result.error.reporterId).toBe(REPORTER_ID);
      }
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('przegrany Serializable (40001, kształt adapter-pg) → retryable CONTENT_REPORT_RATE_LIMITED', async () => {
    // Current @prisma/adapter-pg shape: DriverAdapterError with cause.kind, NO .code.
    const serializationLoss = Object.assign(new Error('write conflict'), {
      cause: { kind: 'TransactionWriteConflict' },
    });
    mockReportScenario({
      createImpl: async () => {
        throw serializationLoss;
      },
    });

    const result = await callReport();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('CONTENT_REPORT_RATE_LIMITED');
      if (result.error.type === 'CONTENT_REPORT_RATE_LIMITED') {
        // Loser tx does not know the real count — reports limit as currentCount.
        expect(result.error.currentCount).toBe(5);
        expect(result.error.limit).toBe(5);
      }
    }
  });

  it('P2002 (defensywny fallback, np. kolizja PK) → CONTENT_REPORT_DUPLICATE', async () => {
    const uniqueViolation = Object.assign(new Error('unique constraint'), {
      code: 'P2002',
    });
    mockReportScenario({
      createImpl: async () => {
        throw uniqueViolation;
      },
    });

    const result = await callReport();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('CONTENT_REPORT_DUPLICATE');
    }
  });

  it('inny błąd DB → DATABASE_ERROR (nie maskowany jako duplikat/rate-limit)', async () => {
    mockReportScenario({
      createImpl: async () => {
        throw new Error('connection reset');
      },
    });

    const result = await callReport();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
  });
});
