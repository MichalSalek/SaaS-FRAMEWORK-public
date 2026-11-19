// Content report errors (kernel `ModerationError`).
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { ModerationError } from '@kernel/domain/moderation/moderation-errors.types';
import {
  respondBadRequest,
  respondForbidden,
  respondNotFound,
  respondTooManyRequests,
} from '../http.responses.utils';
import type {
  ErrorResponder,
  ErrorResponderMap,
  OwnErrors,
} from './error-map.types';

// CONTENT_REPORT_DUPLICATE = legacy any-status fallback (now only a defensive PK-collision path).
// CONTENT_REPORT_DUPLICATE_PENDING = a still-open PENDING duplicate (admin-moderation-4: a re-report
// AFTER resolution is allowed, only an unresolved duplicate blocks). Same UX: 400
// CANNOT_REPORT_CONTENT. SECURITY: no reporterId echo.
const respondDuplicateReport: ErrorResponder<{ galleryRecordId: string }> = (
  res,
  error
) =>
  respondBadRequest(res, APP_EVENTS.INFO.GALLERY.CANNOT_REPORT_CONTENT, {
    galleryRecordId: error.galleryRecordId,
  });

export const moderationErrorMap = {
  CONTENT_REPORT_NOT_FOUND: (res, error) =>
    respondNotFound(res, APP_EVENTS.INFO.APPLICATION.NOT_FOUND, {
      reportId: error.reportId,
    }),

  CONTENT_REPORT_ALREADY_RESOLVED: (res, error) =>
    respondBadRequest(res, APP_EVENTS.INFO.ADMIN.CANNOT_RESOLVE_REPORT, {
      reportId: error.reportId,
    }),

  CONTENT_REPORT_RATE_LIMITED: (res, error) =>
    respondTooManyRequests(res, APP_EVENTS.INFO.GALLERY.REPORT_RATE_LIMITED, {
      currentCount: error.currentCount,
      limit: error.limit,
    }),

  CONTENT_REPORT_DUPLICATE: respondDuplicateReport,
  CONTENT_REPORT_DUPLICATE_PENDING: respondDuplicateReport,

  CONTENT_REPORT_SELF_REPORT: (res, error) =>
    // 403: the caller tried to report her OWN gallery record. A forbidden action, NOT a duplicate,
    // so it has a dedicated event. respondForbidden takes (res, data, event): data first.
    // SECURITY: do not echo reporterId (unnecessary PII).
    respondForbidden(
      res,
      { galleryRecordId: error.galleryRecordId },
      APP_EVENTS.INFO.GALLERY.CONTENT_REPORT_SELF_REPORT
    ),
} satisfies ErrorResponderMap<OwnErrors<ModerationError>>;
