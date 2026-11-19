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
  // DECISION: the GET error path (a click from an e-mail) returns text/html 400 instead of JSON, so the
  // user sees a readable page. The POST error path (RFC 8058 One-Click) stays JSON: the mailer daemon
  // checks the HTTP status mechanically and does not expect HTML.
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
  const tokenPayload = { token: tokenValue };

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
    // DECISION: a permissive validator (NOT VALIDATION_POLICY.validators.newsletterUnsubscribe). Format
    // validation in the middleware would short-circuit a malformed token to 400 application/json before
    // businessLogic, breaking the GET-from-e-mail contract (the user would see raw JSON instead of
    // renderNewsletterLandingHtml). The security boundary is the HMAC signature, not the token length: a
    // garbage token reaches businessLogic, verifyNewsletterUnsubscribeToken returns null => INVALID_TOKEN
    // => GET renders a friendly HTML page, POST (RFC 8058) returns machine-readable JSON. Cost: one
    // constant-time HMAC verification (STRICT rate-limited), negligible.
    // The token was normalised to a string above (query or body, first value of an array, else
    // ''), so the payload is that string and nothing else.
    validationFunction: () => ({ __isValid: true, __data: tokenPayload }),
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
          // DECISION: a server fault (DATABASE_ERROR) goes through the canonical mapErrorToResponse (opaque
          // 500, retriable). A One-Click daemon treats 4xx as a permanent client error and does not retry,
          // so a blanket 400 would lose the unsubscribe on a transient DB failure. Client-token errors keep
          // the machine-readable envelope {unsubscribed:false,error}. The human GET below returns an error
          // page regardless of code (the user retries by refreshing). The twin email/unsubscribe does the
          // same split.
          // DECISION: the event must tell the truth. This branch is a REFUSAL (400) but used to carry
          // NEWSLETTER_UNSUBSCRIBED, a SUCCESS event; a client dispatching on `event` (as the whole
          // `{event,data}` envelope does) read a failed unsubscribe as a success. It now carries
          // VALIDATION_FAILED, like the email/unsubscribe twin, while the specific cause stays in
          // `data.error`, so the RFC 8058 machine-readable contract (status + `{unsubscribed:false,error}`)
          // is unchanged.
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
