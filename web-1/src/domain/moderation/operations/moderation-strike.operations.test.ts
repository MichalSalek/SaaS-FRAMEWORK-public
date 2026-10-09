/**
 * Moderation strike unit tests — applyModerationStrike_IO (apply-strike).
 *
 * Drives DB_CLIENT.use through the global setup proxy (mockDb), calling the op
 * DIRECTLY. Locks in the SPAR-003 concurrency contract and guard ordering:
 *
 *  - admin gate + protected-target guards (self / MASTER_ADMIN) fire BEFORE any
 *    strike row exists;
 *  - the target User row is locked FOR UPDATE (lockUserRow via tx.$queryRaw) and
 *    the lock doubles as the existence check (empty rows → USER_NOT_FOUND, zero
 *    writes);
 *  - optional report_id is validated INSIDE the tx BEFORE the strike insert —
 *    ghost report / report about another user / report with SetNull-ed record all
 *    collapse to CONTENT_REPORT_NOT_FOUND (deliberate anti-enumeration) and write
 *    nothing;
 *  - the counter increment is ATOMIC ({ increment: 1 }, WHERE by user id — never
 *    read-modify-write) while the RESPONSE carries the ACTIVE rolling-window count
 *    (from moderationStrike.count, expires_at > now), NOT the monotonic column;
 *  - ban_recommended threshold = 3 ACTIVE strikes (boundary asserted 2 → false,
 *    3 → true).
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { makeStylistCurrentUser } from '../../../test-utils/fixtures';
import { applyModerationStrike_IO } from './moderation-strike.operations';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';

const ADMIN_ID = 'usr_test_admin_000001';
const TARGET_ID = 'usr_test_target_00001';
const OTHER_USER_ID = 'usr_test_other_000001';
const REPORT_ID = 'rep_test_0000000000001';
/** Monotonic User.moderation_strikes AFTER increment — must NOT leak into the response. */
const MONOTONIC_TOTAL = 99;

const adminCurrentUser = () =>
  makeStylistCurrentUser({
    user: { id: ADMIN_ID, role_id: SystemRoleId.MASTER_ADMIN },
  });

// Top-level raw-query stub bridge (lockUserRow does tx.$queryRaw FOR UPDATE) —
// cast pattern shared with visit-record.operations.test.ts.
type RawStub = Record<string, (...args: never[]) => unknown>;
const rawStub = (fn: (...args: never[]) => unknown): RawStub =>
  fn as unknown as RawStub;

type StrikeScenario = {
  targetRoleId?: string | null;
  lockFound?: boolean;
  activeCount?: number;
  /** Report row resolved by tx.contentReport.findUnique; `null` → not found. */
  report?: { ownerUserId: string | null } | null;
};

const mockStrikeScenario = ({
  targetRoleId = SystemRoleId.STYLIST_ROLE,
  lockFound = true,
  activeCount = 1,
  report = null,
}: StrikeScenario = {}) => {
  const userFindUnique = vi.fn(async (_arg: unknown) =>
    targetRoleId === null ? null : { role_id: targetRoleId }
  );
  const strikeCreate = vi.fn(async (_arg: unknown) => ({ id: 'strike_1' }));
  const strikeCount = vi.fn(async (_arg: unknown) => activeCount);
  const userUpdate = vi.fn(async (_arg: unknown) => ({
    id: TARGET_ID,
    moderation_strikes: MONOTONIC_TOTAL,
  }));
  const reportFindUnique = vi.fn(async (_arg: unknown) =>
    report === null
      ? null
      : {
          gallery_record:
            report.ownerUserId === null
              ? null
              : {
                  created_by_account: {
                    created_by_user_id: report.ownerUserId,
                  },
                },
        }
  );
  mockDb({
    user: { findUnique: userFindUnique, update: userUpdate },
    moderationStrike: { create: strikeCreate, count: strikeCount },
    contentReport: { findUnique: reportFindUnique },
    $queryRaw: rawStub(async () => (lockFound ? [{ id: TARGET_ID }] : [])),
  });
  return {
    userFindUnique,
    strikeCreate,
    strikeCount,
    userUpdate,
    reportFindUnique,
  };
};

const callStrike = (
  overrides: Partial<Parameters<typeof applyModerationStrike_IO>[0]> = {}
) =>
  applyModerationStrike_IO({
    user_id: TARGET_ID,
    reason: 'Powtarzający się spam',
    report_id: undefined,
    admin_id: ADMIN_ID,
    currentUser: adminCurrentUser(),
    ...overrides,
  });

describe('applyModerationStrike_IO — strike z progiem ban-recommendation', () => {
  it('nie-admin → ADMIN_INSUFFICIENT_PERMISSIONS, zero dostępu do DB', async () => {
    const { userFindUnique, strikeCreate } = mockStrikeScenario();

    const result = await callStrike({ currentUser: makeStylistCurrentUser() });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_INSUFFICIENT_PERMISSIONS');
    }
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(strikeCreate).not.toHaveBeenCalled();
  });

  it('target == wołający admin → ADMIN_TARGET_PROTECTED (ADMIN_CANNOT_TARGET_SELF), zero DB', async () => {
    const { userFindUnique, strikeCreate } = mockStrikeScenario();

    const result = await callStrike({ user_id: ADMIN_ID });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_TARGET_PROTECTED');
      if (result.error.type === 'ADMIN_TARGET_PROTECTED') {
        expect(result.error.reason).toBe('ADMIN_CANNOT_TARGET_SELF');
      }
    }
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(strikeCreate).not.toHaveBeenCalled();
  });

  it('target jest MASTER_ADMIN → ADMIN_TARGET_PROTECTED (ADMIN_CANNOT_TARGET_ADMIN), bez strike', async () => {
    const { strikeCreate, userUpdate } = mockStrikeScenario({
      targetRoleId: SystemRoleId.MASTER_ADMIN,
    });

    const result = await callStrike();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_TARGET_PROTECTED');
      if (result.error.type === 'ADMIN_TARGET_PROTECTED') {
        expect(result.error.reason).toBe('ADMIN_CANNOT_TARGET_ADMIN');
      }
    }
    expect(strikeCreate).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  // lock-discipline-allow: test title cites FOR UPDATE documentarily — no SQL lock here
  it('lock FOR UPDATE nie znajduje wiersza → USER_NOT_FOUND, zero zapisów', async () => {
    // Role pre-check returns null (user vanished) — passes the admin guard,
    // the lock inside the tx is the authoritative existence check.
    const { strikeCreate, strikeCount, userUpdate } = mockStrikeScenario({
      targetRoleId: null,
      lockFound: false,
    });

    const result = await callStrike();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('USER_NOT_FOUND');
    }
    expect(strikeCreate).not.toHaveBeenCalled();
    expect(strikeCount).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('happy path: atomowy increment WHERE po user id, odpowiedź niesie ACTIVE count (nie monotoniczny)', async () => {
    const { strikeCreate, strikeCount, userUpdate } = mockStrikeScenario({
      activeCount: 2,
    });

    const result = await callStrike();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.user_id).toBe(TARGET_ID);
      // ACTIVE rolling-window count — NOT the monotonic 99 from user.update.
      expect(result.data.moderation_strikes).toBe(2);
      expect(result.data.ban_recommended).toBe(false); // 2 < 3
    }

    // Strike row: time-bounded (expires_at ~365d ahead), attributed to the admin.
    const createArg = strikeCreate.mock.calls[0]?.[0] as unknown as {
      data: {
        user_id: string;
        reason: string;
        issued_by: string;
        expires_at: Date;
      };
    };
    expect(createArg.data.user_id).toBe(TARGET_ID);
    expect(createArg.data.reason).toBe('Powtarzający się spam');
    expect(createArg.data.issued_by).toBe(ADMIN_ID);
    expect(createArg.data.expires_at).toBeInstanceOf(Date);
    expect(createArg.data.expires_at.getTime()).toBeGreaterThan(
      Date.now() + 300 * 24 * 60 * 60 * 1000
    );

    // Active-count query: rolling window (expires_at > now), scoped to the target.
    const countArg = strikeCount.mock.calls[0]?.[0] as unknown as {
      where: { user_id: string; expires_at: { gt: Date } };
    };
    expect(countArg.where.user_id).toBe(TARGET_ID);
    expect(countArg.where.expires_at.gt).toBeInstanceOf(Date);

    // Counter bump: atomic { increment: 1 } addressed by user id — never
    // a read-modify-write of the column value.
    const updateArg = userUpdate.mock.calls[0]?.[0] as unknown as {
      where: { id: string };
      data: { moderation_strikes: { increment: number } };
    };
    expect(updateArg.where.id).toBe(TARGET_ID);
    expect(updateArg.data.moderation_strikes).toEqual({ increment: 1 });
  });

  it('próg banu: 3 AKTYWNE strike → ban_recommended=true', async () => {
    mockStrikeScenario({ activeCount: 3 });

    const result = await callStrike();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.moderation_strikes).toBe(3);
      expect(result.data.ban_recommended).toBe(true);
    }
  });

  it('report_id wskazujący raport o TYM userze → sukces, walidacja po where {id}', async () => {
    const { reportFindUnique, strikeCreate } = mockStrikeScenario({
      report: { ownerUserId: TARGET_ID },
    });

    const result = await callStrike({ report_id: REPORT_ID });

    expect(result.success).toBe(true);
    const findArg = reportFindUnique.mock.calls[0]?.[0] as unknown as {
      where: { id: string };
    };
    expect(findArg.where.id).toBe(REPORT_ID);
    expect(strikeCreate).toHaveBeenCalledTimes(1);
  });

  it('report_id nieistniejący → CONTENT_REPORT_NOT_FOUND, strike NIE powstaje', async () => {
    const { strikeCreate, userUpdate } = mockStrikeScenario({ report: null });

    const result = await callStrike({ report_id: REPORT_ID });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('CONTENT_REPORT_NOT_FOUND');
      if (result.error.type === 'CONTENT_REPORT_NOT_FOUND') {
        expect(result.error.reportId).toBe(REPORT_ID);
      }
    }
    expect(strikeCreate).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('report_id o INNYM userze → CONTENT_REPORT_NOT_FOUND (anty-enumeracja), zero zapisów', async () => {
    const { strikeCreate, userUpdate } = mockStrikeScenario({
      report: { ownerUserId: OTHER_USER_ID },
    });

    const result = await callStrike({ report_id: REPORT_ID });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('CONTENT_REPORT_NOT_FOUND');
    }
    expect(strikeCreate).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('report z usuniętym rekordem galerii (SetNull) → CONTENT_REPORT_NOT_FOUND', async () => {
    const { strikeCreate } = mockStrikeScenario({
      report: { ownerUserId: null },
    });

    const result = await callStrike({ report_id: REPORT_ID });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('CONTENT_REPORT_NOT_FOUND');
    }
    expect(strikeCreate).not.toHaveBeenCalled();
  });

  it('błąd DB przy role-checku targetu → DATABASE_ERROR', async () => {
    mockDb({
      user: {
        findUnique: vi.fn(async () => {
          throw new Error('connection reset');
        }),
      },
    });

    const result = await callStrike();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
  });
});
