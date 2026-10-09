import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { onboardAsStylist_IO } from '@domain/user/operations/user-onboarding.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  USER_DTO_API_V1['USER_ONBOARD_AS_STYLIST']['REQUEST'],
  USER_DTO_API_V1['USER_ONBOARD_AS_STYLIST']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.USER.USER_ONBOARD_AS_STYLIST,
  method: 'post',
  validate: VALIDATION_POLICY.validators.userOnboardAsStylist,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await onboardAsStylist_IO({
      userId: currentUser.id,
      displayName: body.display_name,
      addressCity: body.address_city,
      phone: body.phone,
      emailMarketing: body.email_marketing ?? false,
      instagramHandle: body.instagram_handle,
      termsAccepted: body.terms_accepted === true,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    // PII redaction: display_name, address_city, phone — ALL PII. Log `has_phone` flag only.
    // Account creation timestamp captured by created_at + meta.created_by_user_id.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.USER.STYLIST_ACCOUNT_CREATED,
        user: { id: currentUser.id },
        requestBody: {
          has_phone: Boolean(body.phone),
        },
        metadata,
      })
    );

    // DECISION (nie usuwaj tego komentarza):
    // 200 OK (NOT 201) — BDX W2.5b. onboardAsStylist is idempotent find-or-create
    // (returns the EXISTING stylist_account when already onboarded; the role is
    // reconciled on every path). Re-calling returns the SAME resource, so 200 is
    // correct — 201 would falsely signal "a new account was created" on the
    // already-onboarded re-call. Mirror claim-session/onboard-client.
    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.USER.STYLIST_ACCOUNT_CREATED
    );
  },
});
