/**
 * Moderation admin unit tests — resolveContentReport_IO (HIDE/DELETE/BAN/WARN/DISMISS).
 *
 * Drives DB_CLIENT.use through the global setup proxy (mockDb), calling the op
 * DIRECTLY. Lock helpers (lockUserRow/lockStylistAccountRow) run through the
 * top-level $queryRaw stub; the cached_gallery_count / cached_likes_count
 * decrements (gallery/favorites $executeRaw helpers) are captured via a raw-SQL
 * spy and asserted by column name + bind values. Locks in the DECISION contracts:
 *
 *  - post-lock status re-read → clean CONTENT_REPORT_ALREADY_RESOLVED for the
 *    loser of a concurrent resolve (no silent no-op, no 500);
 *  - BAN protected-target guard (self / MASTER_ADMIN owner) fires BEFORE any row
 *    is mutated;
 *  - HIDE: likes counted BEFORE the visibility flip; decrements ONLY when the
 *    record actually flipped visible→hidden (updateMany count===1) — re-HIDE of
 *    an already-hidden record decrements NOTHING;
 *  - DELETE: related reports auto-resolved BEFORE the delete (SetNull would
 *    orphan them); decrements gated on wasVisible + deleted.count===1 — deleting
 *    an already-hidden record (decremented at hide-time) subtracts 0;
 *  - BAN: account NOT_ACTIVE + idempotent User flip (WHERE disabled_at:null) with
 *    session eviction gated on the actual state change; bulk-hide decrements by
 *    the REAL flipped count; related reports resolved account-wide;
 *  - orphaned report (gallery_record SetNull): destructive action downgrades to
 *    the EFFECTIVE action WARN (honest echo), DISMISS stays DISMISS (REJECTED);
 *  - 40P01 deadlock (defence-in-depth) → CONTENT_REPORT_ALREADY_RESOLVED,
 *    anything else → DATABASE_ERROR.
 */

import { describe, it, expect, vi } from 'vitest';
import { ModerationAction } from '@kernel/models/moderation/moderation.dto';
import { ContentReportStatusValue } from '@kernel/models/db_models.generated.dto';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  REPORT_ID,
  RECORD_ID,
  ACCOUNT_ID,
  OWNER_USER_ID,
  OWNER_EMAIL,
  ADMIN_ID,
  makeReportRow,
  mockResolveScenario,
  callResolve,
  adminCurrentUser,
  nonAdminCurrentUser,
} from './moderation-admin.test-scenario';

describe('resolveContentReport_IO — rozstrzyganie zgłoszeń', () => {
  describe('guardy i wyścigi', () => {
    it('raport nie istnieje → CONTENT_REPORT_NOT_FOUND, zero zapisów', async () => {
      const { reportUpdate } = mockResolveScenario({ report: null });

      const result = await callResolve();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('CONTENT_REPORT_NOT_FOUND');
        if (result.error.type === 'CONTENT_REPORT_NOT_FOUND') {
          expect(result.error.reportId).toBe(REPORT_ID);
        }
      }
      expect(reportUpdate).not.toHaveBeenCalled();
    });

    it('przegrany lock-race: post-lock re-read widzi APPROVED → ALREADY_RESOLVED, bez zapisu', async () => {
      // Snapshot (pre-lock) still says PENDING, but the concurrent winner
      // auto-resolved this report while we waited for the StylistAccount lock.
      const { reportUpdate, galleryUpdateMany } = mockResolveScenario({
        lockedStatus: ContentReportStatusValue.APPROVED,
      });

      const result = await callResolve();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('CONTENT_REPORT_ALREADY_RESOLVED');
      }
      expect(reportUpdate).not.toHaveBeenCalled();
      expect(galleryUpdateMany).not.toHaveBeenCalled();
    });

    it('raport zniknął w oknie locka (re-read null) → czysty CONTENT_REPORT_NOT_FOUND, nie P2025/500', async () => {
      // Hard-delete raportu (np. FK cascade po erasure zgłaszającej) między
      // snapshotem a zdobyciem locka. Bez guarda: update na nieistniejącym
      // wierszu → P2025 → outer catch (mapuje tylko 40P01) → opaque 500.
      const { reportUpdate, galleryUpdateMany } = mockResolveScenario({
        lockedStatus: null,
      });

      const result = await callResolve();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('CONTENT_REPORT_NOT_FOUND');
      }
      expect(reportUpdate).not.toHaveBeenCalled();
      expect(galleryUpdateMany).not.toHaveBeenCalled();
    });

    it('raport osierocony (gallery_record null) już rozstrzygnięty → ALREADY_RESOLVED bez locka', async () => {
      const { reportUpdate } = mockResolveScenario({
        report: makeReportRow({
          gallery_record: null,
          gallery_record_id: null,
          status: ContentReportStatusValue.REJECTED,
        }),
      });

      const result = await callResolve({ action: ModerationAction.DISMISS });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('CONTENT_REPORT_ALREADY_RESOLVED');
      }
      expect(reportUpdate).not.toHaveBeenCalled();
    });

    it('BAN na własny rekord admina → ADMIN_TARGET_PROTECTED (SELF), zero mutacji', async () => {
      const { reportUpdate, saUpdateMany, userUpdateMany } =
        mockResolveScenario();

      const result = await callResolve({
        action: ModerationAction.BAN,
        currentUser: adminCurrentUser(OWNER_USER_ID), // admin who IS the record owner
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('ADMIN_TARGET_PROTECTED');
        if (result.error.type === 'ADMIN_TARGET_PROTECTED') {
          expect(result.error.reason).toBe('ADMIN_CANNOT_TARGET_SELF');
        }
      }
      expect(reportUpdate).not.toHaveBeenCalled();
      expect(saUpdateMany).not.toHaveBeenCalled();
      expect(userUpdateMany).not.toHaveBeenCalled();
    });

    it('non-admin caller → ADMIN_INSUFFICIENT_PERMISSIONS, zero mutacji (defense-in-depth boundary)', async () => {
      const { reportUpdate, saUpdateMany, userUpdateMany } =
        mockResolveScenario();

      const result = await callResolve({ currentUser: nonAdminCurrentUser() });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('ADMIN_INSUFFICIENT_PERMISSIONS');
      }
      expect(reportUpdate).not.toHaveBeenCalled();
      expect(saUpdateMany).not.toHaveBeenCalled();
      expect(userUpdateMany).not.toHaveBeenCalled();
    });

    it('BAN na rekord innego MASTER_ADMINa → ADMIN_TARGET_PROTECTED (ADMIN), zero mutacji', async () => {
      const report = makeReportRow();
      if (report.gallery_record?.created_by_account) {
        report.gallery_record.created_by_account.created_by_user.role_id =
          SystemRoleId.MASTER_ADMIN;
      }
      const { reportUpdate, userUpdateMany } = mockResolveScenario({ report });

      const result = await callResolve({ action: ModerationAction.BAN });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('ADMIN_TARGET_PROTECTED');
        if (result.error.type === 'ADMIN_TARGET_PROTECTED') {
          expect(result.error.reason).toBe('ADMIN_CANNOT_TARGET_ADMIN');
        }
      }
      expect(reportUpdate).not.toHaveBeenCalled();
      expect(userUpdateMany).not.toHaveBeenCalled();
    });

    it('deadlock 40P01 (defence-in-depth) → ALREADY_RESOLVED zamiast 500', async () => {
      const deadlock = Object.assign(new Error('db conflict'), {
        code: '40P01',
      });
      mockDb({
        contentReport: {
          findUnique: vi.fn(async () => {
            throw deadlock;
          }),
        },
      });

      const result = await callResolve();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('CONTENT_REPORT_ALREADY_RESOLVED');
      }
    });

    it('inny błąd DB → DATABASE_ERROR', async () => {
      mockDb({
        contentReport: {
          findUnique: vi.fn(async () => {
            throw new Error('connection reset');
          }),
        },
      });

      const result = await callResolve();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('DATABASE_ERROR');
      }
    });
  });

  describe('HIDE — flip widoczności z gated dekrementami', () => {
    it('flip widoczny→ukryty: dekrement galerii o 1 i lajków o policzone PRZED ukryciem', async () => {
      const scenario = mockResolveScenario({
        likesCount: 2,
        galleryUpdateManyCount: 1,
      });

      const result = await callResolve({
        action: ModerationAction.HIDE,
        admin_note: 'spam potwierdzony',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.report_id).toBe(REPORT_ID);
        expect(result.data.status).toBe(ContentReportStatusValue.APPROVED);
        expect(result.data.action).toBe(ModerationAction.HIDE);
        expect(result.data.gallery_record_owner_user_id).toBe(OWNER_USER_ID);
        expect(result.data.gallery_record_owner_email).toBe(OWNER_EMAIL);
      }

      // Visibility flip guarded by is_hidden:false (double-decrement shield).
      const hideArg = scenario.galleryUpdateMany.mock
        .calls[0]?.[0] as unknown as {
        where: { gallery_record_id: string; is_hidden: boolean };
        data: { is_hidden: boolean };
      };
      expect(hideArg.where).toEqual({
        gallery_record_id: RECORD_ID,
        is_hidden: false,
      });
      expect(hideArg.data).toEqual({ is_hidden: true });

      // Likes counted BEFORE the flip (after it the record no longer counts).
      expect(
        scenario.favCount.mock.invocationCallOrder[0] ?? Infinity
      ).toBeLessThan(
        scenario.galleryUpdateMany.mock.invocationCallOrder[0] ?? 0
      );

      // Exactly one decrement per counter, addressed to the owning account.
      expect(scenario.galleryDecrements()).toHaveLength(1);
      expect(scenario.galleryDecrements()[0]?.values).toEqual([1, ACCOUNT_ID]);
      expect(scenario.likeDecrements()).toHaveLength(1);
      expect(scenario.likeDecrements()[0]?.values).toEqual([2, ACCOUNT_ID]);

      // Main report closed as APPROVED with the note; related PENDING reports
      // of THIS record auto-resolved (scope 'record').
      const updateArg = scenario.reportUpdate.mock.calls[0]?.[0] as unknown as {
        where: { id: string };
        data: {
          status: string;
          admin_note: string | null;
          resolved_by_id: string;
        };
      };
      expect(updateArg.where.id).toBe(REPORT_ID);
      expect(updateArg.data.status).toBe(ContentReportStatusValue.APPROVED);
      expect(updateArg.data.admin_note).toBe('spam potwierdzony');
      expect(updateArg.data.resolved_by_id).toBe(ADMIN_ID);

      const relatedArg = scenario.reportUpdateMany.mock
        .calls[0]?.[0] as unknown as {
        where: {
          gallery_record_id: string;
          id: { not: string };
          status: string;
        };
        data: { status: string };
      };
      expect(relatedArg.where.gallery_record_id).toBe(RECORD_ID);
      expect(relatedArg.where.id).toEqual({ not: REPORT_ID });
      expect(relatedArg.where.status).toBe(ContentReportStatusValue.PENDING);
      expect(relatedArg.data.status).toBe(ContentReportStatusValue.APPROVED);
    });

    it('re-HIDE już ukrytego rekordu (count 0) → ZERO dekrementów, raport i tak się zamyka', async () => {
      const scenario = mockResolveScenario({
        likesCount: 2,
        galleryUpdateManyCount: 0,
      });

      const result = await callResolve({ action: ModerationAction.HIDE });

      expect(result.success).toBe(true);
      expect(scenario.galleryDecrements()).toHaveLength(0);
      expect(scenario.likeDecrements()).toHaveLength(0);
      // Report still closed + related reports still resolved.
      expect(scenario.reportUpdate).toHaveBeenCalledTimes(1);
      expect(scenario.reportUpdateMany).toHaveBeenCalledTimes(1);
    });

    it('flip bez lajków (likes=0) → dekrement galerii TAK, lajków NIE', async () => {
      const scenario = mockResolveScenario({
        likesCount: 0,
        galleryUpdateManyCount: 1,
      });

      const result = await callResolve({ action: ModerationAction.HIDE });

      expect(result.success).toBe(true);
      expect(scenario.galleryDecrements()).toHaveLength(1);
      expect(scenario.likeDecrements()).toHaveLength(0);
    });
  });
});
