import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { NO_VALIDATION } from '@kernel/policies/validation.policy';
import { dismissGalleryStrength_IO } from '@domain/account/operations/account-gallery-strength.operations';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineHandler<
  ACCOUNT_DTO_API_V1['ACCOUNT_DISMISS_GALLERY_STRENGTH']['REQUEST'],
  ACCOUNT_DTO_API_V1['ACCOUNT_DISMISS_GALLERY_STRENGTH']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ACCOUNT.ACCOUNT_DISMISS_GALLERY_STRENGTH,
  method: 'post',
  // Żądanie nie ma treści: konto bierzemy z sesji, datę stawia serwer — ten
  // sam kanon co `user/export-data`. Schemat zodowy na pustym obiekcie tylko
  // puchłby w pliku walidatorów (limit max-lines) i nic by nie orzekał.
  validate: NO_VALIDATION,
  handle: async (_body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const stylistAccount = requireStylistAccount(currentUser);
    if (!stylistAccount.success) {
      return mapErrorToResponse(res, stylistAccount.error);
    }

    const result = await dismissGalleryStrength_IO(
      stylistAccount.data.account_id
    );

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.ACCOUNT.GALLERY_STRENGTH_DISMISSED,
        user: { id: currentUser.id },
        requestBody: {},
        metadata,
      })
    );

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.ACCOUNT.GALLERY_STRENGTH_DISMISSED
    );
  },
});
