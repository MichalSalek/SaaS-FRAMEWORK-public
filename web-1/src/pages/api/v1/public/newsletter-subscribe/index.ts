import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { resolveTrustedClientIp } from '@app/http/trust-aware-ip';
import {
  isTurnstileEnabled,
  verifyTurnstileToken,
} from '@app/security/turnstile.verify';
import { defineEndpoint } from '@app/http/define-endpoint';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { newsletterSubscribe_IO } from '@domain/newsletter/operations/newsletter-subscribe.operations';
import { extractLocaleFromNodeHeaders } from '@app/http/extract-client-info';
import { NEWSLETTER_CONTRACTS } from '@kernel/domain/newsletter/newsletter.contracts';

export default defineEndpoint(NEWSLETTER_CONTRACTS.NEWSLETTER_SUBSCRIBE, {
  handle: async ({ input, res, req, ok }) => {
    if (isTurnstileEnabled()) {
      const verdict = input.turnstile_token
        ? await verifyTurnstileToken({
            token: input.turnstile_token,
            remoteIp: resolveTrustedClientIp(
              req.headers,
              req.socket?.remoteAddress
            ),
          })
        : { ok: false, reason: 'missing-token' };
      if (!verdict.ok) {
        return mapErrorToResponse(res, {
          type: 'CAPTCHA_VERIFICATION_FAILED',
          reason: verdict.reason,
        });
      }
    }
    const ipAddress =
      resolveTrustedClientIp(req.headers, req.socket?.remoteAddress) ??
      undefined;
    const consentSource =
      typeof input.consentSource === 'string' && input.consentSource.length > 0
        ? input.consentSource
        : undefined;

    const result = await newsletterSubscribe_IO({
      email: input.email,
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
      payload: { email: input.email, consentSource },
      mode: 'info',
    });

    ok(result.data, APP_EVENTS.INFO.NEWSLETTER.NEWSLETTER_PENDING_CONFIRMATION);
  },
});

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '16kb',
    },
  },
};
