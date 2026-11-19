import type { NextApiHandler } from 'next';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { withTimingNextHandlerMiddleware } from '@app/http/timing.middleware';
import { HTTPRequestHandlerMiddleware } from '@app/http/request.middleware';
import type { EMAIL_DTO_API_V1 } from '@kernel/models/email/email.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import {
  getLocaleOrDefault,
  I18N_CONFIG,
} from '@kernel/domain/i18n/i18n.config';
import { buildFrontendBaseUrl } from '@app/environment/environment.utils.api';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { processUnsubscribe_IO } from '@domain/email/operations/email-unsubscribe.operations';

const handler: NextApiHandler = async (req, res) => {
  // Both lifecycle/marketing senders point the visible footer link AND the
  // List-Unsubscribe header at this route (buildEmailUnsubscribeUrl SSOT).
  // Promote the token from query/body to a single shape up front.
  const rawToken: unknown = req.query.token ?? req.body?.token;
  const tokenValue: string =
    typeof rawToken === 'string'
      ? rawToken
      : Array.isArray(rawToken) && typeof rawToken[0] === 'string'
        ? rawToken[0]
        : '';

  const method = (req.method || '').toUpperCase();
  const isGetLike = method === 'GET' || method === 'HEAD';

  // DECISION: GET/HEAD (a human click: footer link, or a mail client opening the List-Unsubscribe URL,
  // prefetch HEAD included) is a pure 302 to the branded, i18n frontend page (ROUTES_FRONT.EMAIL_UNSUBSCRIBE
  // -> EmailUnsubscribePage), which consumes `?token` and unsubscribes via POST to this endpoint. GET/HEAD
  // is side-effect-free (safe against mail-client link prefetch); the mutation happens only on POST.
  //
  // DECISION: the redirect gate is GET/HEAD ONLY. A catch-all `if (!isPost)` also swallowed OPTIONS as a
  // 302 and bypassed HTTPRequestHandlerMiddleware, the ONLY layer that answers the CORS preflight
  // (setCORSHeaders + OPTIONS -> 200, request.middleware.ts). The frontend page auto-fires a CROSS-ORIGIN
  // POST with non-safelisted headers, so the browser sends a mandatory OPTIONS preflight; a 302 without
  // Access-Control-* headers made the browser BLOCK the POST ("Redirect is not allowed for a preflight
  // request") and the human unsubscribe page never unsubscribed. OPTIONS, POST and any other verb now fall
  // through to the middleware (OPTIONS -> CORS 200, POST processed, unsupported verbs 405), like the
  // newsletter-unsubscribe twin. POST (RFC 8058 One-Click from mailer daemons and the frontend page) is
  // machine-readable JSON.
  if (isGetLike) {
    // Forward the email's locale (buildEmailUnsubscribeUrl appends ?locale=)
    // to the frontend page. Next i18n uses a path prefix for non-default
    // locales (/en/..., /de/...) and NO prefix for the default locale
    // (localeDetection: false — without the prefix EN/DE recipients would
    // land on the Polish page).
    const rawLocale = req.query.locale;
    const locale = getLocaleOrDefault(
      typeof rawLocale === 'string' ? rawLocale : undefined
    );
    const localePrefix =
      locale === I18N_CONFIG.defaultLocale ? '' : `/${locale}`;
    const frontUrl = `${buildFrontendBaseUrl()}${localePrefix}${ROUTES_FRONT.EMAIL_UNSUBSCRIBE}`;
    const location = tokenValue
      ? `${frontUrl}?token=${encodeURIComponent(tokenValue)}`
      : frontUrl; // no token → frontend renders its NoTokenState
    res.redirect(302, location);
    return;
  }

  req.body = { token: tokenValue };

  await HTTPRequestHandlerMiddleware<
    EMAIL_DTO_API_V1['EMAIL_UNSUBSCRIBE']['REQUEST']
  >(req, res, {
    eventName: APP_EVENTS.CONFIRMATIONS.EMAIL_UNSUBSCRIBE,
    // contestedHTTPMethod is the runtime method gate (request.middleware compares
    // req.method against it; kernel HTTP_METHODS_CONFIG documents the GET email
    // surface). GET never reaches the middleware — handled by the redirect above.
    contestedHTTPMethod: 'post',
    AUTHENTICATION_CHECK_ENABLED: false,
    validationFunction: VALIDATION_POLICY.validators.emailUnsubscribe,
    businessLogic: async body => {
      const result = await processUnsubscribe_IO(body.token);

      if (!result.success) {
        // DECISION: server faults are split from client-token errors instead of a blanket 400. RFC 8058
        // One-Click daemons (Gmail/Yahoo/Apple) treat 4xx as a permanent client error and do not retry, so a
        // blanket 400 flattened a transient DATABASE_ERROR into 4xx and the daemon dropped the unsubscribe
        // while lifecycle/marketing mail kept going. Server faults go through the canonical
        // mapErrorToResponse (SSOT): DATABASE_ERROR => opaque 500 (retriable, no info leak),
        // EMAIL_USER_NOT_FOUND (a P2025 race) => 404 with enumeration masking. Client-token errors keep the
        // machine-readable envelope {unsubscribed:false,error} (the frontend page maps error.type to i18n).
        const errorType = result.error.type;
        switch (errorType) {
          case 'DATABASE_ERROR':
          case 'EMAIL_USER_NOT_FOUND':
            mapErrorToResponse(res, result.error);
            return;
          case 'EMAIL_INVALID_UNSUBSCRIBE_TOKEN':
          case 'EMAIL_UNSUBSCRIBE_TOKEN_EXPIRED':
          case 'EMAIL_TRANSACTIONAL_NOT_UNSUBSCRIBABLE':
            res.status(400).json({
              event: APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
              data: { unsubscribed: false, error: errorType },
            });
            return;
          default: {
            const _exhaustive: never = errorType;
            void _exhaustive;
            mapErrorToResponse(res, result.error);
            return;
          }
        }
      }

      res.status(200).json({
        event: APP_EVENTS.INFO.EMAIL.EMAIL_UNSUBSCRIBE_SUCCESS,
        data: {
          unsubscribed: true,
          category: result.data.category,
          already_unsubscribed: result.data.already_unsubscribed === true,
        },
      });
    },
  });
};

export default withTimingNextHandlerMiddleware(handler);

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '16kb',
    },
  },
};
