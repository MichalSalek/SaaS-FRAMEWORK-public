import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  recordAuditEvent_IO,
  redactAuditPayload,
} from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondCreated } from '@app/http/http.responses.utils';
import { createGalleryRecord_IO } from '@domain/gallery/operations/gallery-create.operation';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
export default defineHandler<
  GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['REQUEST'],
  GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.GALLERY.CREATE_GALLERY_RECORD,
  method: 'post',
  validate: VALIDATION_POLICY.validators.createGalleryRecord,
  handle: async (body, ctx, metadata, res) => {
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
        ...body,
        created_by_account_id: accountCheck.data.account_id,
      },
      id: currentUser.id,
    });

    if (!result.success) {
      // B40: log upload error so the "upload error rate" anomaly alert
      // (anomaly-alerts.operation.ts liczy CANNOT_CREATE_GALLERY_RECORD w
      // event_log) faktycznie działa — wcześniej zdarzenie nie było zapisywane,
      // więc errorCount zawsze = 0 i alert był martwy. PII-safe: bez asset_url,
      // tylko error_type + nie-PII liczniki.
      runAfterResponse(() =>
        recordAuditEvent_IO({
          eventName: APP_EVENTS.INFO.GALLERY.CANNOT_CREATE_GALLERY_RECORD,
          user: { id: currentUser.id },
          requestBody: {
            ...redactAuditPayload(body, ['nail_length']),
            color_ids_count: body.color_ids.length,
            trait_ids_count: body.trait_ids.length,
          },
          responseBody: { error_type: result.error.type },
          metadata,
        })
      );
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    // PII redaction: asset_url is user-uploaded image URL (potentially identifying).
    // Log only the new gallery_record_id (from response) + nail_length enum + counts.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.GALLERY.GALLERY_RECORD_CREATED,
        user: { id: currentUser.id },
        requestBody: {
          ...redactAuditPayload(body, ['nail_length']),
          color_ids_count: body.color_ids.length,
          trait_ids_count: body.trait_ids.length,
        },
        responseBody: { gallery_record_id: result.data.gallery_record_id },
        metadata,
      })
    );

    const responsePayload: GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['RESPONSE'] =
      { gallery_record_id: result.data.gallery_record_id };
    respondCreated(res, responsePayload);
  },
});
