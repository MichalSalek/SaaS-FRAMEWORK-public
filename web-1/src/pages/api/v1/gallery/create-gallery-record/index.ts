import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { redactAuditPayload } from '@app/event-log/event-log-io.wrapper';
import { createGalleryRecord_IO } from '@domain/gallery/operations/gallery-create.operation';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { GALLERY_CONTRACTS } from '@kernel/domain/gallery/gallery.contracts';

export default defineEndpoint(GALLERY_CONTRACTS.CREATE_GALLERY_RECORD, {
  handle: async ({ input, ctx, res, created, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    // SECURITY: session-derived account_id MUST override any body field of the
    // same name. Spreading body LAST would let attackers create records under
    // other users' accounts via body.created_by_account_id.
    const result = await createGalleryRecord_IO({
      props: {
        ...input,
        created_by_account_id: accountCheck.data.account_id,
      },
      id: currentUser.id,
    });

    if (!result.success) {
      // Log the upload error so the upload-error-rate anomaly alert
      // (anomaly-alerts.operation.ts counts CANNOT_CREATE_GALLERY_RECORD in
      // event_log) actually fires. The event was not written before, so
      // errorCount stayed 0 and the alert never triggered. PII-safe: no asset_url,
      // only error_type and non-PII counters.
      audit(APP_EVENTS.INFO.GALLERY.CANNOT_CREATE_GALLERY_RECORD, {
        user: { id: currentUser.id },
        requestBody: {
          ...redactAuditPayload(input, ['nail_length']),
          color_ids_count: input.color_ids.length,
          trait_ids_count: input.trait_ids.length,
        },
        responseBody: { error_type: result.error.type },
      });
      return mapErrorToResponse(res, result.error);
    }

    // PII redaction: asset_url is user-uploaded image URL (potentially identifying).
    // Log only the new gallery_record_id (from response) + nail_length enum + counts.
    audit(APP_EVENTS.INFO.GALLERY.GALLERY_RECORD_CREATED, {
      user: { id: currentUser.id },
      requestBody: {
        ...redactAuditPayload(input, ['nail_length']),
        color_ids_count: input.color_ids.length,
        trait_ids_count: input.trait_ids.length,
      },
      responseBody: { gallery_record_id: result.data.gallery_record_id },
    });

    created(
      { gallery_record_id: result.data.gallery_record_id },
      APP_EVENTS.INFO.APPLICATION.SUCCESS
    );
  },
});
