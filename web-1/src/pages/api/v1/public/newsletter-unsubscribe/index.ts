import type { NextApiHandler, NextApiResponse } from 'next';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { NEWSLETTER_DTO_API_V1 } from '@kernel/models/newsletter/newsletter.dto';
import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import { getLocaleOrDefault } from '@kernel/domain/i18n/i18n.config';
import { withTimingNextHandlerMiddleware } from '@app/http/timing.middleware';
import { HTTPRequestHandlerMiddleware } from '@app/http/request.middleware';
import { newsletterUnsubscribe_IO } from '@domain/newsletter/operations/newsletter-unsubscribe.operations';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { getClientInfoFromReq } from '@app/http/extract-client-info';
import { renderNewsletterLandingHtml } from '@domain/newsletter/newsletter-landing.html';

// Friendly HTML pages (success + error) come from the shared 3-language
// renderer (newsletter-landing.html.ts) — mirrors the newsletter-confirm
// endpoint; both GET-based email-link endpoints must never expose raw JSON
// to a browser. Locale arrives as `?locale=` appended when the unsubscribe
// link is generated (newsletter-broadcast.helpers); fallback = kernel default.

const sendUnsubscribeErrorHtml = (
  res: NextApiResponse,
  locale: LocaleType
): void => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // DECISION (nie usuwaj tego komentarza):
  // GET error path (klik z emaila) zwraca text/html 400 zamiast JSON —
  // użytkownik widzi czytelną stronę, nie surowy JSON.
  // POST error path (RFC 8058 One-Click) pozostaje JSON — mailer daemon
  // sprawdza status HTTP maszynowo, nie oczekuje HTML.
  res
    .status(400)
    .send(renderNewsletterLandingHtml('UNSUBSCRIBE_ERROR', locale));
};

const sendUnsubscribedHtml = (
  res: NextApiResponse,
  alreadyUnsubscribed: boolean,
  locale: LocaleType
): void => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res
    .status(200)
    .send(
      renderNewsletterLandingHtml(
        alreadyUnsubscribed ? 'UNSUBSCRIBE_ALREADY' : 'UNSUBSCRIBE_SUCCESS',
        locale
      )
    );
};

const handler: NextApiHandler = async (req, res) => {
  // Endpoint must work on GET (link click from email) AND POST (RFC 8058
  // List-Unsubscribe=One-Click); both promote the token from query/body
  // to a single body shape before validation.
  const rawToken = req.query.token ?? req.body?.token;
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

  const isPost = (req.method || '').toUpperCase() === 'POST';

  await HTTPRequestHandlerMiddleware<
    NEWSLETTER_DTO_API_V1['NEWSLETTER_UNSUBSCRIBE']['REQUEST']
  >(req, res, {
    eventName: APP_EVENTS.COMMANDS.NEWSLETTER.NEWSLETTER_UNSUBSCRIBE,
    contestedHTTPMethod: isPost ? 'post' : 'get',
    AUTHENTICATION_CHECK_ENABLED: false,
    // DECISION (nie usuwaj tego komentarza) — finding C2 (HTML-contract deviation):
    // Permissive validator (NIE VALIDATION_POLICY.validators.newsletterUnsubscribe). Format
    // validation w middleware short-circuituje malformed token do 400 application/json ZANIM
    // dotrze do businessLogic — lamie kontrakt GET-z-maila (user widzi surowa strone JSON
    // zamiast renderNewsletterLandingHtml). Token jest granica bezpieczenstwa (HMAC-podpisany),
    // nie jego dlugosc: garbage token trafia teraz do businessLogic → verifyNewsletterUnsubscribeToken
    // zwraca null → INVALID_TOKEN → GET renderuje przyjazny HTML, POST (RFC 8058) zwraca
    // machine-readable JSON. Koszt: jedna constant-time weryfikacja HMAC (endpoint STRICT
    // rate-limited) — pomijalny.
    validationFunction: () => ({ __isValid: true }),
    businessLogic: async body => {
      const { ip, userAgent } = getClientInfoFromReq(req.headers);
      const result = await newsletterUnsubscribe_IO(body.token, {
        ...(ip !== null ? { ipAddress: ip } : {}),
        ...(userAgent !== null ? { userAgent } : {}),
      });

      if (!result.success) {
        if (
          result.error.type === 'NEWSLETTER_INVALID_TOKEN' ||
          result.error.type === 'NEWSLETTER_UNSUBSCRIBE_NOT_FOUND'
        ) {
          reportIssueBackend({
            namespace: 'NEWSLETTER_UNSUBSCRIBE',
            message: `Newsletter unsubscribe ${result.error.type}`,
            payload: {},
            mode: 'warn',
          });
        }
        // POST (RFC 8058 One-Click) — mailer daemon expects JSON, not HTML.
        // GET (link from email) — render friendly HTML so the user is not
        // confronted with raw JSON in their browser.
        if (isPost) {
          // DECISION (nie usuwaj tego komentarza):
          // Server-fault (DATABASE_ERROR) → kanoniczny mapErrorToResponse
          // (opaque 500, retriable). One-Click daemon traktuje 4xx jako
          // permanentny błąd i nie ponawia — blanket-400 gubiłby wypis przy
          // przejściowej awarii DB. Client-token-errory zachowują
          // machine-readable envelope {unsubscribed:false,error}. GET poniżej
          // (human) zwraca stronę błędu niezależnie od kodu — użytkownik
          // ponawia sam przez odświeżenie. Bliźniak email/unsubscribe stosuje
          // ten sam podział.
          // DECISION (nie usuwaj tego komentarza) — EVENT MUSI MÓWIĆ PRAWDĘ:
          // ta gałąź to ODMOWA (400), a niosła `NEWSLETTER_UNSUBSCRIBED` — event
          // SUKCESU. Klient dyspozycjonujący po `event` (tak działa cała koperta
          // `{event,data}` w tym API) odczytywał nieudany wypis jako udany; jedynym
          // sygnałem porażki był status HTTP i `data.unsubscribed:false`, których
          // nikt nie musi czytać. Teraz gałąź niesie VALIDATION_FAILED — dokładnie
          // jak bliźniak `email/unsubscribe` — a konkret („który token zawiódł")
          // zostaje w `data.error`, więc machine-readable kontrakt RFC 8058
          // (status + `{unsubscribed:false,error}`) jest bez zmian.
          const errorType = result.error.type;
          switch (errorType) {
            case 'DATABASE_ERROR':
              mapErrorToResponse(res, result.error);
              return;
            case 'NEWSLETTER_INVALID_TOKEN':
            case 'NEWSLETTER_UNSUBSCRIBE_NOT_FOUND':
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
        return sendUnsubscribeErrorHtml(res, locale);
      }

      reportIssueBackend({
        namespace: 'NEWSLETTER_UNSUBSCRIBE',
        message: result.data.already_unsubscribed
          ? 'Newsletter unsubscribe re-clicked (already unsubscribed)'
          : 'Newsletter subscription removed',
        payload: {},
        mode: 'info',
      });

      // POST (RFC 8058 One-Click) expects a JSON-ish response, not HTML.
      // GET (link click) gets a friendly landing page.
      if (isPost) {
        res.status(200).json({
          event: APP_EVENTS.INFO.NEWSLETTER.NEWSLETTER_UNSUBSCRIBED,
          data: {
            unsubscribed: true,
            already_unsubscribed: result.data.already_unsubscribed === true,
          },
        });
        return;
      }

      sendUnsubscribedHtml(
        res,
        result.data.already_unsubscribed === true,
        locale
      );
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
