import type { NextApiHandler, NextApiResponse } from 'next';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { NEWSLETTER_DTO_API_V1 } from '@kernel/models/newsletter/newsletter.dto';
import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import { getLocaleOrDefault } from '@kernel/domain/i18n/i18n.config';
import { withTimingNextHandlerMiddleware } from '@app/http/timing.middleware';
import { HTTPRequestHandlerMiddleware } from '@app/http/request.middleware';
import { newsletterConfirm_IO } from '@domain/newsletter/operations/newsletter-confirm.operations';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { getClientInfoFromReq } from '@app/http/extract-client-info';
import { renderNewsletterLandingHtml } from '@domain/newsletter/newsletter-landing.html';

// Friendly HTML pages (success + error) come from the shared 3-language
// renderer (newsletter-landing.html.ts). Both paths return text/html so the
// browser never shows raw JSON to a user who clicked a link in their email.
// Locale arrives as `?locale=` appended to the confirm URL when the email is
// generated (newsletter-subscribe operation); fallback = kernel default.

const sendErrorHtml = (res: NextApiResponse, locale: LocaleType): void => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // DECISION (nie usuwaj tego komentarza):
  // Error path zwraca 400 (nie 200) żeby zachować semantykę HTTP dla
  // potencjalnych automatycznych klientów, jednocześnie serwując text/html
  // zamiast JSON — użytkownik klikający link z emaila dostaje czytelną stronę.
  res.status(400).send(renderNewsletterLandingHtml('CONFIRM_ERROR', locale));
};

const sendConfirmedHtml = (
  res: NextApiResponse,
  alreadyConfirmed: boolean,
  locale: LocaleType
): void => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res
    .status(200)
    .send(
      renderNewsletterLandingHtml(
        alreadyConfirmed ? 'CONFIRM_ALREADY' : 'CONFIRM_SUCCESS',
        locale
      )
    );
};

const handler: NextApiHandler = async (req, res) => {
  // DECISION (nie usuwaj tego komentarza):
  // Newsletter confirm jest GET-as-Command z premedytacją. Confirmation link
  // kliknięty z emaila musi działać via GET — żaden klient pocztowy nie wyśle
  // POSTa z hiperlinku. Reguła "GET = Query, POST = Command" tutaj NIE
  // aplikuje się; bezpieczeństwo zapewnia HMAC-podpisany / DB-backed token,
  // nie HTTP method. Idempotencja: ponowne kliknięcie w już-potwierdzony
  // token zwraca success (already_confirmed=true), nie błąd. Stąd również
  // wybór namespace'u APP_EVENTS.CONFIRMATIONS.* zamiast COMMANDS.* —
  // odróżnia ten klass-of-endpoint od standardowych mutacji POST/PATCH.
  // Routing: HTTPRequestHandlerMiddleware z AUTHENTICATION_CHECK_ENABLED=false
  // + contestedHTTPMethod='get'. Permission wired dla NOT_LOGGED_IN role.
  //
  // GET endpoint with [token] in the URL path — promote to body for the
  // middleware's validation step (matches the email-unsubscribe pattern).
  const rawToken = req.query.token;
  const tokenValue =
    typeof rawToken === 'string'
      ? rawToken
      : Array.isArray(rawToken)
        ? (rawToken[0] ?? '')
        : '';
  req.body = { token: tokenValue };

  const rawLocale = req.query.locale;
  const locale = getLocaleOrDefault(
    typeof rawLocale === 'string' ? rawLocale : undefined
  );

  await HTTPRequestHandlerMiddleware<
    NEWSLETTER_DTO_API_V1['NEWSLETTER_CONFIRM']['REQUEST']
  >(req, res, {
    eventName: APP_EVENTS.CONFIRMATIONS.NEWSLETTER_CONFIRM,
    contestedHTTPMethod: 'get',
    AUTHENTICATION_CHECK_ENABLED: false,
    // DECISION (nie usuwaj tego komentarza) — finding C2 (HTML-contract deviation):
    // Permissive validator (NIE VALIDATION_POLICY.validators.newsletterConfirm). Format
    // validation w middleware (Step 6) short-circuituje niepoprawny token do 400
    // application/json VALIDATION_FAILED ZANIM dotrze do businessLogic — a to lamie
    // udokumentowany kontrakt tego endpointu (user klikajacy link z maila NIGDY nie widzi
    // surowego JSON, tylko renderNewsletterLandingHtml). Token jest granica bezpieczenstwa
    // (DB-backed lookup), nie jego format: malformed/garbage token trafia teraz do
    // businessLogic → newsletterConfirm_IO.findUnique nie znajduje wiersza → INVALID_TOKEN
    // → sendErrorHtml (przyjazna strona 400 text/html). Koszt: jeden indeksowany findUnique
    // na smieciowy token (endpoint jest STRICT rate-limited) — pomijalny.
    validationFunction: () => ({ __isValid: true }),
    businessLogic: async body => {
      const { ip, userAgent } = getClientInfoFromReq(req.headers);
      const result = await newsletterConfirm_IO(body.token, {
        ...(ip !== null ? { ipAddress: ip } : {}),
        ...(userAgent !== null ? { userAgent } : {}),
      });

      if (!result.success) {
        if (result.error.type === 'NEWSLETTER_INVALID_TOKEN') {
          reportIssueBackend({
            namespace: 'NEWSLETTER_CONFIRM',
            message: 'Newsletter confirmation token invalid',
            payload: {},
            mode: 'warn',
          });
        }
        return sendErrorHtml(res, locale);
      }

      reportIssueBackend({
        namespace: 'NEWSLETTER_CONFIRM',
        message: result.data.already_confirmed
          ? 'Newsletter confirmation re-clicked (already confirmed)'
          : 'Newsletter subscription confirmed',
        payload: {},
        mode: 'info',
      });

      sendConfirmedHtml(res, result.data.already_confirmed === true, locale);
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
