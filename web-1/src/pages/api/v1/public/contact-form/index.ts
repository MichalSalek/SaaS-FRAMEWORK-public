import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { defineEndpoint } from '@app/http/define-endpoint';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { resolveTrustedClientIp } from '@app/http/trust-aware-ip';
import {
  isTurnstileEnabled,
  verifyTurnstileToken,
} from '@app/security/turnstile.verify';
import { submitContactForm_IO } from '@domain/contact/operations/contact-form.operations';
import { PUBLIC_CONTRACTS } from '@kernel/domain/public/public.contracts';

export default defineEndpoint(PUBLIC_CONTRACTS.CONTACT_FORM_SUBMIT, {
  handle: async ({ input, res, req, ok }) => {
    // DECISION: the anti-bot gate is a HARD server-side check, run BEFORE submitContactForm_IO (no admin
    // mail on failure). The frontend disabled button/widget is UX only: a bot POSTing straight to the
    // endpoint bypasses it and MUST get stuck here. Feature flag BY PRESENCE: no TURNSTILE_SECRET_KEY
    // (dev/staging) = gate OFF. With the secret present, a missing token or a negative/failed-closed
    // siteverify verdict => 403 CAPTCHA_VERIFICATION_FAILED (fail-closed trade-off: turnstile.verify.ts).
    if (isTurnstileEnabled()) {
      const token = input.turnstile_token;
      if (!token) {
        return mapErrorToResponse(res, {
          type: 'CAPTCHA_VERIFICATION_FAILED',
          reason: 'missing-token',
        });
      }
      const remoteIp = resolveTrustedClientIp(
        req.headers,
        req.socket?.remoteAddress
      );
      const verdict = await verifyTurnstileToken({ token, remoteIp });
      if (!verdict.ok) {
        return mapErrorToResponse(res, {
          type: 'CAPTCHA_VERIFICATION_FAILED',
          reason: verdict.reason,
        });
      }
    }

    const result = await submitContactForm_IO(input);
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }
    ok(undefined, APP_EVENTS.INFO.PUBLIC.CONTACT_FORM_SUBMITTED);
  },
});

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '32kb',
    },
  },
};
