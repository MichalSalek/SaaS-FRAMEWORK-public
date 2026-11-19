/**
 * Content Moderation — Report Operation
 *
 * Creates a content report for a gallery record.
 * Includes rate limiting (5 reports/hour per user) and duplicate detection.
 */

import { DB_CLIENT } from '@app/db/db.client';
import { TIME } from '@kernel/application/constants.config';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { isSerializationConflict } from '@app/db/serialization-conflict';
import { isP2002 } from '@app/db/prisma-error';
import { databaseFailure } from '@app/errors/error-result.helpers';
import {
  GALLERY_RECORD_VISIBILITY_SELECT,
  isGalleryRecordVisibleToViewer,
} from '@domain/gallery/gallery-record-visibility';
import { success, failure } from '@kernel/application/result.types';
import type { OperationResult } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { GalleryRecordNotFoundError } from '@kernel/domain/gallery/gallery-errors.types';
import type {
  ContentReportRateLimitedError,
  ContentReportDuplicateError,
  ContentReportDuplicatePendingError,
  ContentReportSelfReportError,
} from '@kernel/domain/moderation/moderation-errors.types';
import type { ContentReportReason } from '@kernel/models/moderation/moderation.dto';
import {
  ContentReportReasonValue,
  ContentReportStatusValue,
} from '@kernel/models/db_models.generated.dto';

const VALID_PRISMA_REASONS = Object.values(ContentReportReasonValue);

// DECISION: ContentReportReason is the Prisma enum value (UPPERCASE), mapped directly. The OTHER fallback
// stays for defence (e.g. a stale client sending lowercase).
const toValidPrismaReason = (
  reason: ContentReportReason
): ContentReportReason =>
  VALID_PRISMA_REASONS.includes(reason)
    ? reason
    : ContentReportReasonValue.OTHER;

const REPORT_RATE_LIMIT = 5;
const RATE_LIMIT_WINDOW_MS = TIME.MS_PER_HOUR; // 1 hour

type CreateReportParams = {
  gallery_record_id: string;
  reporter_id: string;
  reason: ContentReportReason;
  description?: string | undefined;
};

type CreateReportResult = {
  report_id: string;
};

export const createContentReport_IO = async (
  params: CreateReportParams
): Promise<
  OperationResult<
    CreateReportResult,
    | GalleryRecordNotFoundError
    | ContentReportRateLimitedError
    | ContentReportDuplicateError
    | ContentReportDuplicatePendingError
    | ContentReportSelfReportError
    | DatabaseError
  >
> => {
  const { gallery_record_id, reporter_id, reason, description } = params;

  try {
    // 1. Verify the gallery record exists AND is visible to the reporter (outside TX —
    //    read-only). The select also carries the ownership chain
    //    (gallery_record → created_by_account → created_by_user_id) for the self-report guard.
    const galleryRecord = await DB_CLIENT.use.galleryRecord.findUnique({
      where: { gallery_record_id },
      select: GALLERY_RECORD_VISIBILITY_SELECT,
    });

    // DECISION: report-abuse uses the SAME per-record visibility gate as get-by-id
    // (isGalleryRecordVisibleToViewer: owner / !is_hidden + stylist publicly visible + pinned or ACTIVE pair).
    // With an existence-only check an unpaired or revoked client could report a private unpinned record she
    // gets 404 for elsewhere, an already hidden record re-entered the moderation queue, a pinned record of a
    // banned stylist was reportable, and 201 vs 404 made the endpoint an existence oracle. Every miss
    // collapses into the SAME GALLERY_RECORD_NOT_FOUND as a nonexistent id. The owner passes the gate on
    // purpose and is stopped by the self-report guard below (403): she knows her own record exists, so no oracle.
    if (
      !galleryRecord ||
      !(await isGalleryRecordVisibleToViewer(galleryRecord, reporter_id))
    ) {
      return failure({
        type: 'GALLERY_RECORD_NOT_FOUND',
        recordId: gallery_record_id,
      });
    }

    // DECISION: self-report guard. A stylist cannot report her own gallery record (queue inflation, no business
    // sense). The comparison is in users.id space, NOT account_id: reporter_id = currentUser.id (User.id,
    // FK ContentReport.reporter_id -> User.id) against gallery_record -> created_by_account ->
    // created_by_user_id (the relation moderation-admin.operations.ts uses). reporter == owner fails BEFORE the
    // report is created. It is not CONTENT_REPORT_DUPLICATE (409 "already reported" is the wrong semantics):
    // self-report is a dedicated error mapped to 403 (see error-mapper).
    if (galleryRecord.created_by_account.created_by_user_id === reporter_id) {
      reportIssueBackend({
        namespace: 'MODERATION_SELF_REPORT_BLOCKED',
        message: `User ${reporter_id} attempted to report own gallery record ${gallery_record_id}`,
        payload: { reporter_id, gallery_record_id },
        mode: 'info',
      });
      return failure({
        type: 'CONTENT_REPORT_SELF_REPORT',
        galleryRecordId: gallery_record_id,
        reporterId: reporter_id,
      });
    }

    // DECISION: the rate-limit count, the pending-duplicate read and the insert
    // share one Serializable transaction. A 40001 (isSerializationConflict) maps
    // to CONTENT_REPORT_RATE_LIMITED, which the error map sends as 429.
    // Test: web-1/src/domain/moderation/operations/moderation-report.operation.test.ts
    // (a fake 40001 maps to that type; a sequential count of 5 maps too). It does
    // not run concurrent inserts.
    return await DB_CLIENT.use.$transaction(
      async tx => {
        // 2. Rate limit check: max 5 reports per hour per user — SERIALIZATION POINT.
        const oneHourAgo = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
        const recentReportCount = await tx.contentReport.count({
          where: {
            reporter_id,
            created_at: { gte: oneHourAgo },
          },
        });

        if (recentReportCount >= REPORT_RATE_LIMIT) {
          reportIssueBackend({
            namespace: 'MODERATION_RATE_LIMITED',
            message: `User ${reporter_id} exceeded report rate limit: ${recentReportCount}/${REPORT_RATE_LIMIT} in last hour`,
            payload: { reporter_id, currentCount: recentReportCount },
            mode: 'info',
          });
          return failure({
            type: 'CONTENT_REPORT_RATE_LIMITED' as const,
            currentCount: recentReportCount,
            limit: REPORT_RATE_LIMIT,
          });
        }

        // Duplicate check: block only when a PENDING report by this reporter on
        // this record already exists. A resolved or rejected report does not
        // block a fresh report. The broad unique on (gallery_record_id,
        // reporter_id) was removed; PENDING scoping is this read.
        const pendingReport = await tx.contentReport.findFirst({
          where: {
            gallery_record_id,
            reporter_id,
            status: ContentReportStatusValue.PENDING,
          },
          select: { id: true },
        });

        if (pendingReport) {
          return failure({
            type: 'CONTENT_REPORT_DUPLICATE_PENDING' as const,
            galleryRecordId: gallery_record_id,
            reporterId: reporter_id,
          });
        }

        // 4. Create the report — reason maps directly to Prisma enum (UPPERCASE)
        const report = await tx.contentReport.create({
          data: {
            gallery_record_id,
            reporter_id,
            reason: toValidPrismaReason(reason),
            description: description || null,
          },
          select: { id: true },
        });

        reportIssueBackend({
          namespace: 'MODERATION_REPORT_CREATED',
          message: `Content report created: ${report.id} for record ${gallery_record_id} by user ${reporter_id}`,
          payload: { reportId: report.id, reason },
          mode: 'info',
        });

        return success({ report_id: report.id });
      },
      { isolationLevel: 'Serializable' }
    );
  } catch (error) {
    // DECISION: a 40001 (isSerializationConflict) maps to CONTENT_REPORT_RATE_LIMITED
    // (429, respondTooManyRequests). That type is not CONTENT_REPORT_DUPLICATE_PENDING
    // (400). currentCount is unknown here, so the limit is reported as currentCount.
    // Detect with isSerializationConflict, not `code === 'P2034'`: under
    // @prisma/adapter-pg 40001 arrives as DriverAdapterError
    // (TransactionWriteConflict) without .code.
    if (isSerializationConflict(error)) {
      reportIssueBackend({
        namespace: 'MODERATION_RATE_LIMITED',
        message: `Report serialization conflict for user ${reporter_id} on record ${gallery_record_id} — rolled back (retryable 429). Limit: ${REPORT_RATE_LIMIT}`,
        payload: { reporter_id, gallery_record_id, limit: REPORT_RATE_LIMIT },
        mode: 'info',
      });
      return failure({
        type: 'CONTENT_REPORT_RATE_LIMITED',
        currentCount: REPORT_RATE_LIMIT,
        limit: REPORT_RATE_LIMIT,
      });
    }
    // DECISION: P2002 here is a defensive fallback. The broad unique on
    // (gallery_record_id, reporter_id) was removed, so that pair no longer
    // raises P2002. A hit still maps to CONTENT_REPORT_DUPLICATE (400).
    // Detection is structural (isP2002), not instanceof. Other throws go to
    // databaseFailure. Rationale: @app/db/prisma-error.ts.
    if (isP2002(error)) {
      return failure({
        type: 'CONTENT_REPORT_DUPLICATE',
        galleryRecordId: gallery_record_id,
        reporterId: reporter_id,
      });
    }
    return databaseFailure('createContentReport', error);
  }
};
