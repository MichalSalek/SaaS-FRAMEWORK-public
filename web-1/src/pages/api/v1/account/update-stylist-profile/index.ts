import { defineHandler } from '@app/http/define-handler';

// /api/v1/account/update-stylist-profile
// D5 (run 25 TRD): atomic consolidated endpoint replacing 3 prior commands.
// One HTTP request → one Prisma $transaction → all-or-nothing semantics.
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  recordAuditEvent_IO,
  redactAuditPayload,
} from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { accountUpdateStylistProfile_IO } from '@domain/account/operations/account-stylist-profile.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { mapErrorToResponse } from '@app/http/error-mapper';
export default defineHandler<
  ACCOUNT_DTO_API_V1['UPDATE_STYLIST_PROFILE']['REQUEST'],
  ACCOUNT_DTO_API_V1['UPDATE_STYLIST_PROFILE']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ACCOUNT.UPDATE_STYLIST_PROFILE,
  method: 'post',
  validate: VALIDATION_POLICY.validators.updateStylistProfile,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    // SECURITY: account_id from session (requireStylistAccount), NEVER from body.
    // Prevents IDOR — a stylist may only mutate their OWN profile.
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await accountUpdateStylistProfile_IO({
      account_id: accountCheck.data.account_id,
      created_by_user_id: accountCheck.data.created_by_user_id,
      stylist_pricing_plan: accountCheck.data.pricing_plan,
      body,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    const { account, updated_sections } = result.data;

    const responsePayload: ACCOUNT_DTO_API_V1['UPDATE_STYLIST_PROFILE']['RESPONSE'] =
      {
        account_id: account.account_id,
        updated_sections,
        address_city: account.address_city,
        latitude: account.latitude,
        longitude: account.longitude,
        business_name: account.business_name,
        vanity_url: account.vanity_url,
        instagram_handle: account.instagram_handle,
        brand_accent_color: account.brand_accent_color,
      };

    // Wrapper audit event (granular per-section events emitted by the operation itself
    // post-commit). Schedule BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.ACCOUNT.STYLIST_PROFILE_UPDATED,
        user: currentUser,
        requestBody: redactAuditPayload(body, ['vanity', 'social']),
        responseBody: { updated_sections },
        metadata,
      })
    );

    respondSuccess(
      res,
      responsePayload,
      APP_EVENTS.INFO.ACCOUNT.STYLIST_PROFILE_UPDATED
    );
  },
});
