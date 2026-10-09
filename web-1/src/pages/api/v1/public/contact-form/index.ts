import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { PUBLIC_DTO_API_V1 } from '@kernel/models/public/public.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { resolveTrustedClientIp } from '@app/http/trust-aware-ip';
import {
  isTurnstileEnabled,
  verifyTurnstileToken,
} from '@app/security/turnstile.verify';
import { submitContactForm_IO } from '@domain/contact/operations/contact-form.operations';

export default defineHandler<
  PUBLIC_DTO_API_V1['CONTACT_FORM_SUBMIT']['REQUEST'],
  PUBLIC_DTO_API_V1['CONTACT_FORM_SUBMIT']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.PUBLIC.CONTACT_FORM_SUBMIT,
  method: 'post',
  // DECISION (nie usuwaj): endpoint auth-off (authCheck:false) — permission check pomijany; celowo NIE w BASE_PERMISSIONS (różni się od newsletter/confirmations, ale gate i tak nie działa). Public by-design.
  authCheck: false,
  validate: VALIDATION_POLICY.validators.contactFormSubmit,
  handle: async (body, _ctx, _metadata, res, req) => {
    // DECISION (nie usuwaj tego komentarza):
    // Anti-bot gate = TWARDA ifka SERWEROWA, wykonywana PRZED submitContactForm_IO
    // (zero maili do admina przy failu). Frontendowy disabled-button/widget to tylko
    // UX — bot POST-ujący prosto na endpoint omija front całkowicie i MUSI utknąć tu.
    // Feature-flag BY PRESENCE: brak TURNSTILE_SECRET_KEY (dev/staging) = gate OFF,
    // back-compat bez tokenu. Sekret obecny: brak tokenu LUB negatywny/failed-closed
    // werdykt siteverify ⇒ 403 CAPTCHA_VERIFICATION_FAILED (fail-closed trade-off
    // udokumentowany w turnstile.verify.ts).
    if (isTurnstileEnabled()) {
      const token = body.turnstile_token;
      if (!token) {
        return mapErrorToResponse(res, {
          type: 'CAPTCHA_VERIFICATION_FAILED',
          reason: 'missing-token',
        });
      }

      // Trust-aware IP (ten sam resolver co rate-limit/view-dedup) — nigdy surowy
      // x-forwarded-for. Null (nieskonfigurowany trust + brak socketa) ⇒ remoteip
      // po prostu pominięty w siteverify (opcjonalny dla CF).
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

    const result = await submitContactForm_IO(body);

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      undefined,
      APP_EVENTS.INFO.PUBLIC.CONTACT_FORM_SUBMITTED
    );
  },
});

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '32kb',
    },
  },
};
