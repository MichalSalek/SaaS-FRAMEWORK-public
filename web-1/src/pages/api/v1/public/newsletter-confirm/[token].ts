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
  // DECISION: the error path returns 400 (not 200) to keep HTTP semantics for automated clients, while
  // serving text/html instead of JSON so a user clicking the e-mail link sees a readable page.
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
  // DECISION: newsletter confirm is GET-as-Command on purpose. The confirmation link clicked from an
  // e-mail must work via GET (no mail client sends a POST from a hyperlink). "GET = Query, POST = Command"
  // does not apply here; safety comes from the HMAC-signed / DB-backed token, not the HTTP method.
  // Concurrent confirmation returns already_confirmed; a later re-click uses a consumed token and
  // returns the same friendly error as an unknown token. Hence also the
  // APP_EVENTS.CONFIRMATIONS.* namespace instead of COMMANDS.*. Routing: HTTPRequestHandlerMiddleware with
  // AUTHENTICATION_CHECK_ENABLED=false + contestedHTTPMethod='get'; permission wired for NOT_LOGGED_IN.
  //
  // GET endpoint with [token] in the URL path: promoted to body for the middleware's validation step
  // (matches the email-unsubscribe pattern).
  const rawToken = req.query.token;
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

  await HTTPRequestHandlerMiddleware<
    NEWSLETTER_DTO_API_V1['NEWSLETTER_CONFIRM']['REQUEST']
  >(req, res, {
    eventName: APP_EVENTS.CONFIRMATIONS.NEWSLETTER_CONFIRM,
    contestedHTTPMethod: 'get',
    AUTHENTICATION_CHECK_ENABLED: false,
    // DECISION: a permissive validator (NOT VALIDATION_POLICY.validators.newsletterConfirm). Format
    // validation in the middleware short-circuits a malformed token to 400 application/json
    // VALIDATION_FAILED before businessLogic, which breaks this endpoint's documented contract (a user
    // clicking the e-mail link must never see raw JSON, only renderNewsletterLandingHtml). The security
    // boundary is the DB-backed token lookup, not its format: a garbage token reaches
    // newsletterConfirm_IO.findUnique, finds no row => INVALID_TOKEN => sendErrorHtml (friendly 400
    // text/html). Cost: one indexed findUnique on a junk token (STRICT rate-limited), negligible.
    // The token was normalised to a string above (query or body, first value of an array, else
    // ''), so the payload is that string and nothing else.
    validationFunction: () => ({ __isValid: true, __data: tokenPayload }),
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
            message:
              'Newsletter confirmation token is unknown or already consumed',
            payload: { reason: 'unknown_or_consumed_token' },
            mode: 'info',
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
