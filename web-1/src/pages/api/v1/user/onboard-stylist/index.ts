import { defineEndpoint } from '@app/http/define-endpoint';
import { USER_CONTRACTS } from '@kernel/domain/user/user.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { onboardAsStylist_IO } from '@domain/user/operations/user-onboarding.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(USER_CONTRACTS.USER_ONBOARD_AS_STYLIST, {
  handle: async ({ input: body, ctx, meta: metadata, res }) => {
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
          email_marketing: body.email_marketing ?? false,
          source: 'registration',
        },
        metadata,
      })
    );

    // DECISION: 200 OK, not 201. onboardAsStylist is an idempotent find-or-create (returns the EXISTING
    // stylist_account when already onboarded; the role is reconciled on every path), so a re-call returns
    // the SAME resource and 201 would falsely signal a new account. Same as claim-session / onboard-client.
    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.USER.STYLIST_ACCOUNT_CREATED
    );
  },
});
