import { getEffectivePricingPlan } from '@kernel/domain/pricing/effective-plan';
import { normalizeCountryCode } from '@kernel/domain/localization/country.config';
import { detectRequestCountry } from '@app/localization/country.detector';
import { defineEndpoint } from '@app/http/define-endpoint';
import { ACCOUNT_CONTRACTS } from '@kernel/domain/account/account.contracts';

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
import { mapErrorToResponse } from '@app/http/error-mapper';
export default defineEndpoint(ACCOUNT_CONTRACTS.UPDATE_STYLIST_PROFILE, {
  handle: async ({ input: body, ctx, meta: metadata, res, req }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    // SECURITY: account_id from session (requireStylistAccount), NEVER from body.
    // Prevents IDOR — a stylist may only mutate their OWN profile.
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const location = body.location;
    const hasAddress =
      location !== undefined &&
      location !== null &&
      ['address_city', 'address_street', 'address_country'].some(key =>
        Object.hasOwn(location, key)
      );
    const detectedCountry =
      hasAddress &&
      !normalizeCountryCode(location?.address_country) &&
      !normalizeCountryCode(accountCheck.data.address_country)
        ? detectRequestCountry(req.headers)
        : null;
    if (detectedCountry !== null && location != null) {
      location.address_country = detectedCountry;
    }
    const result = await accountUpdateStylistProfile_IO({
      account_id: accountCheck.data.account_id,
      created_by_user_id: accountCheck.data.created_by_user_id,
      stylist_pricing_plan: getEffectivePricingPlan(accountCheck.data),
      body,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    const { account, updated_sections } = result.data;

    const responsePayload = {
      account_id: account.account_id,
      updated_sections,
      address_city: account.address_city,
      address_street: account.address_street,
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
