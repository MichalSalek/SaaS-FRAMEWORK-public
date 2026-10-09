import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import type { NEWSLETTER_DTO_API_V1 } from '@kernel/models/newsletter/newsletter.dto';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { newsletterSubscribe_IO } from '@domain/newsletter/operations/newsletter-subscribe.operations';
import {
  extractIpFromNodeHeaders,
  extractLocaleFromNodeHeaders,
} from '@app/http/extract-client-info';
export default defineHandler<
  NEWSLETTER_DTO_API_V1['NEWSLETTER_SUBSCRIBE']['REQUEST'],
  NEWSLETTER_DTO_API_V1['NEWSLETTER_SUBSCRIBE']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.NEWSLETTER.NEWSLETTER_SUBSCRIBE,
  method: 'post',
  authCheck: false,
  validate: VALIDATION_POLICY.validators.newsletterSubscribe,
  handle: async (body, _ctx, _metadata, res, req) => {
    const ipAddress = extractIpFromNodeHeaders(req.headers) ?? undefined;
    const consentSource =
      typeof body.consentSource === 'string' && body.consentSource.length > 0
        ? body.consentSource
        : undefined;

    const result = await newsletterSubscribe_IO({
      email: body.email,
      locale: extractLocaleFromNodeHeaders(req.headers),
      ...(ipAddress !== undefined ? { ipAddress } : {}),
      ...(consentSource !== undefined ? { consentSource } : {}),
    });

    if (!result.success) {
      if (result.error.type === 'SUBSCRIBE_FAILED') {
        reportIssueBackend({
          namespace: 'NEWSLETTER_SUBSCRIBE',
          message: 'Newsletter subscribe failed',
          payload: { error: result.error },
          mode: 'error',
        });
      }
      return mapErrorToResponse(res, result.error);
    }

    reportIssueBackend({
      namespace: 'NEWSLETTER_SUBSCRIBE',
      message: 'Newsletter subscriber pending confirmation',
      payload: { email: body.email, consentSource },
      mode: 'info',
    });

    respondSuccess<NEWSLETTER_DTO_API_V1['NEWSLETTER_SUBSCRIBE']['RESPONSE']>(
      res,
      result.data,
      APP_EVENTS.INFO.NEWSLETTER.NEWSLETTER_PENDING_CONFIRMATION
    );
  },
});

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '16kb',
    },
  },
};
