import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type { EVENT_INFO_TYPE } from '../../domain/commands-and-queries/cqrs.types';

// --- Admin email-template preview ---
//
// Read-only render of any outgoing email template with sample data, for the
// admin panel "Podgląd maili" tool (owner polishes templates visually). The
// backend renders the real production template (renderEmailTemplate) with a
// sample-vars registry — the preview is byte-identical to a sent email minus
// the personalization data.

/** Query: which template + which locale to render. */
export type AdminGetEmailPreviewRequest = {
  templateId: string;
  locale: string;
};

/** Rendered output — same shape renderEmailTemplate returns to the transport. */
export type AdminGetEmailPreviewResponse = {
  subject: string;
  html: string;
  text: string;
};

// --- Admin email pipeline (dry run of the lifecycle sweep) ---
//
// What the sweep would send today and within the next 24 h, computed by the
// same resolvers the sweep uses but without sending anything. Covers the trial
// sequence and the onboarding reminder; the weekly frequency cap and quiet
// hours are applied at send time and are not simulated here.

/** One mail the sweep would send. */
export type AdminEmailPipelineSend = {
  userId: string;
  email: string;
  /** Schedule rule id, e.g. TRIAL_D1_NUDGE or ONBOARDING_INCOMPLETE_24H. */
  ruleId: string;
  /** The rule's audit event, the key the admin schedule labels mails by. */
  infoEvent: EVENT_INFO_TYPE;
  templateId: string;
  due: 'today' | 'tomorrow';
};

/** Personal first-month codes minted from lifecycle mails (Stripe). */
export type AdminEmailOfferStats = {
  issued: number;
  redeemed: number;
  /** Unused and not expired yet. */
  active: number;
};

export type AdminGetEmailPipelineResponse = {
  /** Last recorded sweep (EMAIL_SWEEP_COMPLETED), null when none on record. */
  lastSweepAt: string | null;
  lastSweepEmailsSent: number | null;
  sweepsLast7Days: number;
  queue: AdminEmailPipelineSend[];
  /** Null when Stripe could not be read; the rest of the panel still works. */
  offers: AdminEmailOfferStats | null;
};

export type AdminMailingDtoApi = {
  ADMIN_GET_EMAIL_PIPELINE: {
    REQUEST: undefined;
    RESPONSE: AdminGetEmailPipelineResponse;
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      AdminGetEmailPipelineResponse,
      DetailedErrorPayload<undefined>
    >;
  };
  ADMIN_GET_EMAIL_PREVIEW: {
    REQUEST: AdminGetEmailPreviewRequest;
    RESPONSE: AdminGetEmailPreviewResponse;
    RESPONSE_ERROR: DetailedErrorPayload<AdminGetEmailPreviewRequest>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      AdminGetEmailPreviewRequest,
      AdminGetEmailPreviewResponse,
      DetailedErrorPayload<AdminGetEmailPreviewRequest>
    >;
  };
};
