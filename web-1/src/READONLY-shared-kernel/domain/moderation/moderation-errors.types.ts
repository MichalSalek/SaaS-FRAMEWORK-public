export type ContentReportNotFoundError = {
  type: 'CONTENT_REPORT_NOT_FOUND';
  reportId: string;
};

export type ContentReportAlreadyResolvedError = {
  type: 'CONTENT_REPORT_ALREADY_RESOLVED';
  reportId: string;
};

export type ContentReportRateLimitedError = {
  type: 'CONTENT_REPORT_RATE_LIMITED';
  currentCount: number;
  limit: number;
};

export type ContentReportDuplicateError = {
  type: 'CONTENT_REPORT_DUPLICATE';
  galleryRecordId: string;
  reporterId: string;
};

// A report by this reporter on this record is ALREADY PENDING (unresolved). Distinct
// from CONTENT_REPORT_DUPLICATE (legacy, now only a defensive PK-collision fallback):
// re-reporting AFTER a prior report was resolved/rejected is allowed (admin-moderation-4),
// only a still-open PENDING duplicate is rejected.
export type ContentReportDuplicatePendingError = {
  type: 'CONTENT_REPORT_DUPLICATE_PENDING';
  galleryRecordId: string;
  reporterId: string;
};

export type ContentReportSelfReportError = {
  type: 'CONTENT_REPORT_SELF_REPORT';
  galleryRecordId: string;
  reporterId: string;
};

export type ModerationError =
  | ContentReportNotFoundError
  | ContentReportAlreadyResolvedError
  | ContentReportRateLimitedError
  | ContentReportDuplicateError
  | ContentReportDuplicatePendingError
  | ContentReportSelfReportError;
