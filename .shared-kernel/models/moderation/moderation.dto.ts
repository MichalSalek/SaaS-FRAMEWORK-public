import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import {
  ContentReportReasonValue,
  ContentReportStatusValue,
} from '../db_models.generated.dto';
import type {
  ContentReportReason as ContentReportReasonType,
  ContentReportStatus as ContentReportStatusType,
} from '../db_models.generated.dto';

// DECISION (nie usuwaj tego komentarza):
// CONTENT_REPORT_REASONS / CONTENT_REPORT_STATUSES re-eksportują wartości z generated DTO
// (Prisma enum, UPPERCASE). Dual definicja (lowercase array + uppercase Prisma enum)
// była źródłem bugów (wymagała .toLowerCase() casts). SSOT = Prisma enum value object.
export type ContentReportReason = ContentReportReasonType;
export type ContentReportStatus = ContentReportStatusType;

export const CONTENT_REPORT_REASONS = Object.values(
  ContentReportReasonValue
) as ReadonlyArray<ContentReportReason>;

export const CONTENT_REPORT_STATUSES = Object.values(
  ContentReportStatusValue
) as ReadonlyArray<ContentReportStatus>;

// Value namespace for `ContentReportStatus.PENDING` usage at call sites.
export const ContentReportStatus = ContentReportStatusValue;

// DISMISS = "zgłoszenie bezzasadne": resolves the report as REJECTED with ZERO
// side effects on the content/owner (no hide/delete/strike/ban, no owner email).
// Without it the REJECTED status was unreachable from the admin UI.
export const MODERATION_ACTIONS = [
  'WARN',
  'HIDE',
  'DELETE',
  'BAN',
  'DISMISS',
] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const ModerationAction = {
  WARN: 'WARN',
  HIDE: 'HIDE',
  DELETE: 'DELETE',
  BAN: 'BAN',
  DISMISS: 'DISMISS',
} as const satisfies Record<ModerationAction, ModerationAction>;

export type MODERATION_DTO_API_V1 = {
  /** Zgłoszenie rekordu galerii przez użytkownika (powód + opcjonalny opis); reporter brany z sesji, zwraca report_id. */
  REPORT_GALLERY_RECORD: {
    REQUEST: {
      gallery_record_id: string;
      reason: ContentReportReason;
      description?: string;
    };
    RESPONSE: {
      report_id: string;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      MODERATION_DTO_API_V1['REPORT_GALLERY_RECORD']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      MODERATION_DTO_API_V1['REPORT_GALLERY_RECORD']['REQUEST'],
      MODERATION_DTO_API_V1['REPORT_GALLERY_RECORD']['RESPONSE'],
      MODERATION_DTO_API_V1['REPORT_GALLERY_RECORD']['RESPONSE_ERROR']
    >;
  };

  /** Admin rozstrzyga zgłoszenie akcją WARN/HIDE/DELETE/BAN/DISMISS; zwraca report_id, nowy status i faktyczną akcję. */
  ADMIN_RESOLVE_REPORT: {
    REQUEST: {
      report_id: string;
      action: ModerationAction;
      admin_note?: string;
    };
    RESPONSE: {
      report_id: string;
      status: ContentReportStatus;
      action: ModerationAction;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      MODERATION_DTO_API_V1['ADMIN_RESOLVE_REPORT']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      MODERATION_DTO_API_V1['ADMIN_RESOLVE_REPORT']['REQUEST'],
      MODERATION_DTO_API_V1['ADMIN_RESOLVE_REPORT']['RESPONSE'],
      MODERATION_DTO_API_V1['ADMIN_RESOLVE_REPORT']['RESPONSE_ERROR']
    >;
  };

  /** Admin nadaje strike'a użytkownikowi (powód, opcjonalne report_id); zwraca liczbę strike'ów i flagę ban_recommended. */
  ADMIN_APPLY_STRIKE: {
    REQUEST: {
      user_id: string;
      reason: string;
      report_id?: string;
    };
    RESPONSE: {
      user_id: string;
      moderation_strikes: number;
      ban_recommended: boolean;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      MODERATION_DTO_API_V1['ADMIN_APPLY_STRIKE']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      MODERATION_DTO_API_V1['ADMIN_APPLY_STRIKE']['REQUEST'],
      MODERATION_DTO_API_V1['ADMIN_APPLY_STRIKE']['RESPONSE'],
      MODERATION_DTO_API_V1['ADMIN_APPLY_STRIKE']['RESPONSE_ERROR']
    >;
  };

  /** Widok admina: stronicowana lista zgłoszeń treści z filtrem statusu, danymi rekordu galerii i zgłaszającego. */
  ADMIN_GET_CONTENT_REPORTS: {
    REQUEST: {
      status?: ContentReportStatus;
      page?: number;
      limit?: number;
    };
    RESPONSE: {
      reports: Array<{
        id: string;
        gallery_record_id: string | null;
        reporter_id: string;
        reason: ContentReportReason;
        description: string | null;
        status: ContentReportStatus;
        admin_note: string | null;
        created_at: string | Date;
        resolved_at: string | Date | null;
        gallery_record: {
          asset_url: string;
          created_by_account_id: string;
          gallery_record_owner_user_id: string | null;
          // ACTIVE strikes of the record owner (rolling window, parity with
          // ADMIN_APPLY_STRIKE response semantics) — lets the moderator see the
          // owner's standing BEFORE deciding on an action. 0 when owner unknown.
          owner_active_strikes: number;
        } | null;
        reporter: {
          email: string;
          name: string;
        } | null;
      }>;
      total_count: number;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      MODERATION_DTO_API_V1['ADMIN_GET_CONTENT_REPORTS']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      MODERATION_DTO_API_V1['ADMIN_GET_CONTENT_REPORTS']['REQUEST'],
      MODERATION_DTO_API_V1['ADMIN_GET_CONTENT_REPORTS']['RESPONSE'],
      MODERATION_DTO_API_V1['ADMIN_GET_CONTENT_REPORTS']['RESPONSE_ERROR']
    >;
  };
};
