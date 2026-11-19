// UI/features/shared/moderation/hooks/useReportGalleryRecord.ts
// TQ v5 mutation -- POST /api/v1/gallery/report
// Authenticated endpoint: reports a gallery record (logged-in users only).
// Body shape: { gallery_record_id, reason, description? }.
// Stack: TanStack Query v5.

import { useMutation } from '@tanstack/react-query';
import { reportGalleryRecord_IO } from '../../../../../domain/moderation/moderationIO.possibilities.api';
import { trackFlowStep } from '../../../../../application/analytics/flow-events';
import type { MODERATION_DTO_API_V1 } from '@kernel/models/moderation/moderation.dto';

/* --- Types --- */

type ReportRequest = MODERATION_DTO_API_V1['REPORT_GALLERY_RECORD']['REQUEST'];

/* --- Hook --- */

// DECISION: no onSuccess invalidation, by design. Reporting is a side-channel action that does not
// change any gallery data the UI displays, so invalidating gallery queries would be pure waste.
// Duplicate protection is server-side: the backend REJECTS a duplicate report for the same
// (reporter, record) while a PENDING report exists (CONTENT_REPORT_DUPLICATE_PENDING -> 400
// CANNOT_REPORT_CONTENT envelope); re-reporting AFTER resolution is allowed. There is no
// "resubmission counter": repeated submits are blocked, not counted.
//
// DECISION: one-shot lockout. After the FIRST SUCCESSFUL submit the Report button is disabled for
// the rest of the session (per gallery_record_id, useState in the consuming component).
// localStorage persistence was deliberately skipped: cross-session re-reports are harmless because
// the backend rejects duplicates of a still-PENDING report anyway, and a permanently dead button
// after a browser restart is worse UX. If cross-session persistence becomes a product requirement,
// localStorage can be layered on top without breaking this contract.
export function useReportGalleryRecord() {
  return useMutation({
    mutationFn: (req: ReportRequest) => reportGalleryRecord_IO(req),
    meta: { suppressGlobalError: true },
    onSuccess: (_data, req) => {
      trackFlowStep('moderation', 'report_sent', { reason: req.reason });
    },
  });
}
