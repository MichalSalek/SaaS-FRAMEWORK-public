/**
 * resolveContentReport_IO — DELETE / BAN / WARN / DISMISS suites.
 * Sibling of moderation-admin.operations.test.ts (split for max-lines);
 * contract documentation lives in that file header.
 */
import { describe, it, expect } from 'vitest';
import { ModerationAction } from '@kernel/models/moderation/moderation.dto';
import {
  AccountStatusValue,
  ContentReportStatusValue,
} from '@kernel/models/db_models.generated.dto';
import {
  REPORT_ID,
  RECORD_ID,
  ACCOUNT_ID,
  OWNER_USER_ID,
  makeReportRow,
  mockResolveScenario,
  callResolve,
} from './moderation-admin.test-scenario';

describe('resolveContentReport_IO — rozstrzyganie zgłoszeń (akcje destrukcyjne)', () => {
  describe('DELETE — hard-delete z visibility-gated dekrementami', () => {
    it('widoczny rekord: related-resolve PRZED delete, dekrementy galeria=1 / lajki=policzone', async () => {
      const scenario = mockResolveScenario({
        likesCount: 3,
        deletedCount: 1,
      });

      const result = await callResolve({ action: ModerationAction.DELETE });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe(ContentReportStatusValue.APPROVED);
        expect(result.data.action).toBe(ModerationAction.DELETE);
      }

      // Related reports resolved BEFORE the delete (SetNull would orphan them).
      expect(
        scenario.reportUpdateMany.mock.invocationCallOrder[0] ?? Infinity
      ).toBeLessThan(
        scenario.galleryDeleteMany.mock.invocationCallOrder[0] ?? 0
      );

      const deleteArg = scenario.galleryDeleteMany.mock
        .calls[0]?.[0] as unknown as { where: { gallery_record_id: string } };
      expect(deleteArg.where).toEqual({ gallery_record_id: RECORD_ID });

      expect(scenario.galleryDecrements()[0]?.values).toEqual([1, ACCOUNT_ID]);
      expect(scenario.likeDecrements()[0]?.values).toEqual([3, ACCOUNT_ID]);
    });

    it('rekord JUŻ ukryty: lajki nieliczone, delete przechodzi, ZERO dekrementów (odjęte przy HIDE)', async () => {
      const report = makeReportRow();
      if (report.gallery_record) {
        report.gallery_record.is_hidden = true;
      }
      const scenario = mockResolveScenario({ report, deletedCount: 1 });

      const result = await callResolve({ action: ModerationAction.DELETE });

      expect(result.success).toBe(true);
      // wasVisible=false → the likes pre-count is skipped entirely.
      expect(scenario.favCount).not.toHaveBeenCalled();
      expect(scenario.galleryDecrements()).toHaveLength(0);
      expect(scenario.likeDecrements()).toHaveLength(0);
      expect(scenario.galleryDeleteMany).toHaveBeenCalledTimes(1);
    });

    it('wyścig: rekord zniknął przed delete (count 0) → sukces bez dekrementów (owner-delete już policzył)', async () => {
      const scenario = mockResolveScenario({
        likesCount: 3,
        deletedCount: 0,
      });

      const result = await callResolve({ action: ModerationAction.DELETE });

      expect(result.success).toBe(true);
      expect(scenario.galleryDecrements()).toHaveLength(0);
      expect(scenario.likeDecrements()).toHaveLength(0);
      // Main report still closed.
      expect(scenario.reportUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('BAN — dezaktywacja konta + bulk-hide', () => {
    it('happy path: konto NOT_ACTIVE, idempotentny flip usera, evict sesji, dekrementy wg realnie ukrytych', async () => {
      const scenario = mockResolveScenario({
        likesCount: 4,
        galleryUpdateManyCount: 5,
        bannedCount: 1,
      });

      const result = await callResolve({ action: ModerationAction.BAN });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe(ContentReportStatusValue.APPROVED);
        expect(result.data.action).toBe(ModerationAction.BAN);
      }

      // Account deactivation.
      const saArg = scenario.saUpdateMany.mock.calls[0]?.[0] as unknown as {
        where: { account_id: string };
        data: { account_status: string };
      };
      expect(saArg.where).toEqual({ account_id: ACCOUNT_ID });
      expect(saArg.data.account_status).toBe(AccountStatusValue.NOT_ACTIVE);

      // Idempotent User flip: CAS on disabled_at:null (first-disable timestamp = SSOT).
      const userArg = scenario.userUpdateMany.mock.calls[0]?.[0] as unknown as {
        where: { id: string; disabled_at: null };
        data: { is_active: boolean; disabled_at: Date };
      };
      expect(userArg.where).toEqual({ id: OWNER_USER_ID, disabled_at: null });
      expect(userArg.data.is_active).toBe(false);
      expect(userArg.data.disabled_at).toBeInstanceOf(Date);

      // Sessions evicted only because the flip actually happened (count>0).
      const sessArg = scenario.sessionDeleteMany.mock
        .calls[0]?.[0] as unknown as { where: { userId: string } };
      expect(sessArg.where).toEqual({ userId: OWNER_USER_ID });

      // Bulk-hide of all still-visible records of the account.
      const bulkArg = scenario.galleryUpdateMany.mock
        .calls[0]?.[0] as unknown as {
        where: { created_by_account_id: string; is_hidden: boolean };
        data: { is_hidden: boolean };
      };
      expect(bulkArg.where).toEqual({
        created_by_account_id: ACCOUNT_ID,
        is_hidden: false,
      });
      expect(bulkArg.data).toEqual({ is_hidden: true });

      // Likes pre-count mirrors the bulk-hide predicate exactly.
      const banLikesArg = scenario.favCount.mock.calls[0]?.[0] as unknown as {
        where: {
          record: { created_by_account_id: string; is_hidden: boolean };
        };
      };
      expect(banLikesArg.where.record).toEqual({
        created_by_account_id: ACCOUNT_ID,
        is_hidden: false,
      });

      // Decrements by the REAL flipped count (5) and real likes (4).
      expect(scenario.galleryDecrements()[0]?.values).toEqual([5, ACCOUNT_ID]);
      expect(scenario.likeDecrements()[0]?.values).toEqual([4, ACCOUNT_ID]);

      // Related reports resolved ACCOUNT-wide.
      const relatedArg = scenario.reportUpdateMany.mock
        .calls[0]?.[0] as unknown as {
        where: {
          gallery_record: { created_by_account_id: string };
          id: { not: string };
          status: string;
        };
      };
      expect(relatedArg.where.gallery_record).toEqual({
        created_by_account_id: ACCOUNT_ID,
      });
      expect(relatedArg.where.id).toEqual({ not: REPORT_ID });
      expect(relatedArg.where.status).toBe(ContentReportStatusValue.PENDING);
    });

    it('re-BAN już wyłączonego usera (flip count 0) → sesje NIE evictowane ponownie', async () => {
      const scenario = mockResolveScenario({
        galleryUpdateManyCount: 0,
        bannedCount: 0,
      });

      const result = await callResolve({ action: ModerationAction.BAN });

      expect(result.success).toBe(true);
      expect(scenario.sessionDeleteMany).not.toHaveBeenCalled();
      // Nothing flipped visible→hidden → zero decrements.
      expect(scenario.galleryDecrements()).toHaveLength(0);
      expect(scenario.likeDecrements()).toHaveLength(0);
    });
  });

  describe('WARN / DISMISS / raport osierocony', () => {
    it('WARN z żywym rekordem: raport APPROVED, ZERO mutacji treści i bez auto-resolve related', async () => {
      const scenario = mockResolveScenario();

      const result = await callResolve({ action: ModerationAction.WARN });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe(ContentReportStatusValue.APPROVED);
        expect(result.data.action).toBe(ModerationAction.WARN);
      }
      expect(scenario.galleryUpdateMany).not.toHaveBeenCalled();
      expect(scenario.galleryDeleteMany).not.toHaveBeenCalled();
      expect(scenario.saUpdateMany).not.toHaveBeenCalled();
      expect(scenario.reportUpdateMany).not.toHaveBeenCalled();
      expect(scenario.rawCalls.filter(c => c.sql.includes('cached_'))).toEqual(
        []
      );
    });

    it('DISMISS z żywym rekordem: raport REJECTED, zero skutków ubocznych', async () => {
      const scenario = mockResolveScenario();

      const result = await callResolve({ action: ModerationAction.DISMISS });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe(ContentReportStatusValue.REJECTED);
        expect(result.data.action).toBe(ModerationAction.DISMISS);
      }
      const updateArg = scenario.reportUpdate.mock.calls[0]?.[0] as unknown as {
        data: { status: string };
      };
      expect(updateArg.data.status).toBe(ContentReportStatusValue.REJECTED);
      expect(scenario.galleryUpdateMany).not.toHaveBeenCalled();
      expect(scenario.galleryDeleteMany).not.toHaveBeenCalled();
      expect(scenario.reportUpdateMany).not.toHaveBeenCalled();
    });

    it('osierocony raport + BAN → efektywna akcja WARN (uczciwe echo), owner-pola null', async () => {
      const scenario = mockResolveScenario({
        report: makeReportRow({
          gallery_record: null,
          gallery_record_id: null,
        }),
      });

      const result = await callResolve({ action: ModerationAction.BAN });

      expect(result.success).toBe(true);
      if (result.success) {
        // No record → no ban happened; echoing BAN would lie to the admin.
        expect(result.data.action).toBe(ModerationAction.WARN);
        expect(result.data.status).toBe(ContentReportStatusValue.APPROVED);
        expect(result.data.gallery_record_id).toBeNull();
        expect(result.data.gallery_record_owner_user_id).toBeNull();
        expect(result.data.gallery_record_owner_email).toBeNull();
      }
      expect(scenario.reportUpdate).toHaveBeenCalledTimes(1);
      expect(scenario.saUpdateMany).not.toHaveBeenCalled();
      expect(scenario.userUpdateMany).not.toHaveBeenCalled();
      expect(scenario.galleryUpdateMany).not.toHaveBeenCalled();
    });

    it('osierocony raport + DISMISS → zostaje DISMISS/REJECTED (bez downgrade do WARN)', async () => {
      mockResolveScenario({
        report: makeReportRow({
          gallery_record: null,
          gallery_record_id: null,
        }),
      });

      const result = await callResolve({ action: ModerationAction.DISMISS });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.action).toBe(ModerationAction.DISMISS);
        expect(result.data.status).toBe(ContentReportStatusValue.REJECTED);
      }
    });
  });
});
