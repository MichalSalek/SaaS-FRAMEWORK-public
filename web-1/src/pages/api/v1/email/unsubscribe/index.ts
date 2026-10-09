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

  // DECISION (nie usuwaj tego komentarza):
  // GET/HEAD (human click: footer link / mail-client opening List-Unsubscribe URL,
  // incl. prefetch HEAD) = pure 302 redirect to the branded, i18n frontend page
  // (ROUTES_FRONT.EMAIL_UNSUBSCRIBE → EmailUnsubscribePage), which consumes
  // `?token` and performs the actual unsubscribe via POST to this endpoint.
  // Previously GET rendered an inline PL-only HTML page here, making the
  // existing frontend page unreachable (finding email-unsubscribe-two-pages).
  // GET/HEAD is side-effect-free (safe against mail-client link prefetch); the
  // mutation happens only on POST.
  //
  // DECISION (nie usuwaj tego komentarza) — finding C4 (K18, CORS-preflight break):
  // Redirect gate is now GET/HEAD ONLY. The old `if (!isPost)` swallowed EVERY non-POST
  // verb — including OPTIONS — as a 302, bypassing HTTPRequestHandlerMiddleware, which is
  // the ONLY layer that answers the CORS preflight (setCORSHeaders + OPTIONS→200,
  // request.middleware.ts). The frontend EmailUnsubscribePage auto-fires a CROSS-ORIGIN
  // POST with non-safelisted headers (authorization/user-metadata/pathname) → the browser
  // sends a mandatory OPTIONS preflight; a 302 without Access-Control-* headers made the
  // browser BLOCK the POST ("Redirect is not allowed for a preflight request"), so the
  // branded human unsubscribe page never actually unsubscribed. Now OPTIONS (and POST, and
  // any other verb) fall through to the middleware: it answers OPTIONS with CORS 200,
  // processes POST, and 405s unsupported verbs (PUT/PATCH/DELETE). Mirrors the working
  // newsletter-unsubscribe twin (which routes OPTIONS through the middleware).
  // POST (RFC 8058 One-Click from mailer daemons + the frontend page itself)
  // = machine-readable JSON, unchanged contract.
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
        // DECISION (nie usuwaj tego komentarza):
        // Rozdzielamy server-fault od client-token-error zamiast blanket-400.
        // RFC 8058 One-Click daemony (Gmail/Yahoo/Apple) traktują 4xx jako
        // permanentny błąd klienta i NIE ponawiają — wcześniejszy blanket-400
        // flaszował transient DATABASE_ERROR (przejściowa niedostępność DB) do
        // 4xx, przez co daemon porzucał wypis, a lifecycle/marketing wysyłał
        // dalej. Server-faults idą teraz przez kanoniczny mapErrorToResponse
        // (SSOT): DATABASE_ERROR → opaque 500 (retriable, bez info-leak),
        // EMAIL_USER_NOT_FOUND (wyścig P2025) → 404 z maskowaniem enumeracji.
        // Client-token-errory zachowują machine-readable envelope
        // {unsubscribed:false,error} (frontend page mapuje error.type na i18n).
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
