import type { NextApiRequest, NextApiResponse } from 'next';
import type Stripe from 'stripe';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { ENV_VARS } from '@app/environment/environment.config';
import {
  respondBadRequest,
  respondGeneralError,
} from '@app/http/http.responses.utils';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { withRateLimitCheck } from '@app/http/rate-limit.middleware';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import { STRIPE_WEBHOOK_LOG_NAMESPACE } from '@app/stripe/stripe.config';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';

// Stripe webhook ingress, step 1: method/rate-limit/secret gate, raw body and signature check.
// The claim of the StripeEvent row lives in stripe-webhook-claim.ts, the pre-transaction Stripe
// reads in stripe-event-prefetch.ts, the in-transaction dispatch in stripe-event-router.ts.

// DECISION: hard cap on the raw webhook body. index.ts sets `bodyParser: false`, which disables
// Next.js' default 1MB limit, and this route is PUBLIC with the signature verified only AFTER the
// body is read, so an unauthenticated attacker could POST a multi-hundred-MB body and OOM the
// Node heap (rate-limit caps request COUNT, not body SIZE). Real Stripe events are < ~256KB; 1MB
// is a comfortable ceiling. On overflow we throw BEFORE allocating further; the throw lands in
// constructStripeEvent()'s try/catch -> respondBadRequest (400/VALIDATION_FAILED), never a 500.
const MAX_WEBHOOK_BODY_BYTES = 1_048_576; // 1 MB

export const readRawBody = async ({
  req,
}: {
  req: NextApiRequest;
}): Promise<Buffer> => {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    totalBytes += buf.length;
    if (totalBytes > MAX_WEBHOOK_BODY_BYTES) {
      throw new Error('Webhook body exceeds max size');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
};

/**
 * Gate the incoming request BEFORE the raw body is read: rate limit and the presence of the
 * webhook secret. Constructs nothing — the event is built later by
 * {@link constructStripeEvent}. Returns `{ proceed: false }` once a rejection response
 * has already been written, so the caller must return immediately.
 *
 * DECISION: the method is enforced by the route's wrapper, `withPublicHandler({ allowedMethods:
 * ['POST'] })`, which answers any other method with 405 + Allow before this runs (pinned by
 * raw-handler-methods.test.ts). Do not add a second method check here.
 */
export const verifyWebhookRequest = ({
  req,
  res,
}: {
  req: NextApiRequest;
  res: NextApiResponse;
}): {
  proceed: boolean;
} => {
  // The method (POST only) is gated by `withPublicHandler({ allowedMethods: ['POST'] })` before
  // this runs: a non-POST request gets 405 + Allow from the wrapper.

  // Rate limiting check
  if (!withRateLimitCheck(req, res)) {
    return { proceed: false };
  }

  // Critical security check: webhook secret must be configured
  if (!ENV_VARS.STRIPE_WEBHOOK_SECRET) {
    reportIssueBackend({
      namespace: STRIPE_WEBHOOK_LOG_NAMESPACE,
      message: 'CRITICAL: STRIPE_WEBHOOK_SECRET is not configured',
      payload: {},
      mode: 'error',
    });
    // respondGeneralError is intentional: webhook infra error (missing secret), not OperationResult
    respondGeneralError(res, undefined);
    return { proceed: false };
  }

  return { proceed: true };
};

/**
 * Verify Stripe signature and construct event from raw body.
 * Returns the event or null if verification failed (response already sent).
 */
export const constructStripeEvent = async ({
  req,
  res,
}: {
  req: NextApiRequest;
  res: NextApiResponse;
}): Promise<Stripe.Event | null> => {
  const stripe = getStripe();

  try {
    const rawBody = await readRawBody({ req });
    const signature = req.headers[CUSTOM_HEADERS.stripeSignature];

    // Validate signature exists
    if (signature == null || Array.isArray(signature)) {
      // DECISION: do NOT log req.headers (Authorization, cookies, x-internal-secret and other
      // sensitive headers). Log only diagnostic fields (signature shape, user-agent) so
      // misconfigured webhook clients can be debugged without leaking secrets.
      reportIssueBackend({
        namespace: STRIPE_WEBHOOK_LOG_NAMESPACE,
        message: 'Missing stripe-signature header',
        payload: {
          signaturePresent: signature != null,
          signatureIsArray: Array.isArray(signature),
          userAgent:
            typeof req.headers['user-agent'] === 'string'
              ? req.headers['user-agent']
              : null,
          contentType:
            typeof req.headers['content-type'] === 'string'
              ? req.headers['content-type']
              : null,
        },
        mode: 'warn',
      });
      respondBadRequest(
        res,
        APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
        undefined
      );
      return null;
    }

    reportIssueBackend({
      namespace: STRIPE_WEBHOOK_LOG_NAMESPACE,
      message: 'Constructing event',
      payload: { type: 'signature_received' },
      mode: 'info',
    });

    // Verify signature and construct event.
    // Defensive guard: STRIPE_WEBHOOK_SECRET is also checked in verifyWebhookRequest(),
    // but typed `string | undefined` at the kernel level — re-check here for type safety
    // and to fail explicitly if the upstream guard is ever skipped.
    const webhookSecret = ENV_VARS.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      reportIssueBackend({
        namespace: STRIPE_WEBHOOK_LOG_NAMESPACE,
        message:
          'CRITICAL: STRIPE_WEBHOOK_SECRET missing at constructStripeEvent',
        payload: {},
        mode: 'error',
      });
      respondGeneralError(res, undefined);
      return null;
    }
    return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    reportIssueBackend({
      namespace: 'STRIPE_WEBHOOK_SIGNATURE_ERROR',
      message: 'Invalid Stripe signature',
      payload: error,
      mode: 'warn',
    });
    respondBadRequest(
      res,
      APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
      undefined
    );
    return null;
  }
};
