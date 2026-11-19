import crypto from 'crypto';
import { DB_CLIENT } from '@app/db/db.client';
import { isP2002 } from '@app/db/prisma-error';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  NewsletterError,
  NewsletterAlreadySubscribedError,
  NewsletterSubscribeFailedError,
} from '@kernel/domain/newsletter/newsletter-errors.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import { getLocaleOrDefault } from '@kernel/domain/i18n/i18n.config';
import { buildFrontendBaseUrl } from '@app/environment/environment.utils.api';
import { sendTransactionalEmail } from '@app/email-handler/email-transactional';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { DatabaseError } from '@kernel/application/common-errors.types';

type NewsletterSubscribeSuccess = {
  subscribed: true;
  pending_confirmation: true;
};

type NewsletterSubscribeInput = {
  email: string;
  ipAddress?: string;
  consentSource?: string;
  locale?: LocaleType;
};

const generateConfirmationToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

const buildConfirmationUrl = (token: string, locale: LocaleType): string =>
  `${buildFrontendBaseUrl()}/api/v1/public/newsletter-confirm/${encodeURIComponent(token)}?locale=${locale}`;

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

// Randomized latency floor for timing-oracle mitigation. Applied to BOTH success
// branches (ALREADY_SUBSCRIBED fast-path AND fresh/pending subscribe) so response
// time cannot distinguish a confirmed-member email from a non-member one.
const SUBSCRIBE_TIMING_FLOOR_BASE_MS = 400;
const SUBSCRIBE_TIMING_FLOOR_JITTER_MS = 300;

// DECISION: the timing floor applies to BOTH success paths, not only ALREADY_SUBSCRIBED. With the floor on the
// fast path alone, fresh-subscribe returned at real mail-delivery speed (dev stub ~15ms, prod Resend
// ~150-400ms), often BELOW the 400ms floor, so the member path was systematically slower and one measurement
// classified membership (timing-enumeration oracle). Flooring both puts both in [400,700)ms. Accepted
// residual: when mail delivery FAILS, fresh-subscribe returns 500 SUBSCRIBE_FAILED before the floor while
// ALREADY_SUBSCRIBED stays 200, a weak 200-vs-500 oracle conditional on a mail outage; closing it would mean
// returning success despite a failed delivery, which breaks the double-opt-in UX. The leaked fact (newsletter
// membership) is low-sensitivity.
const enforceSubscribeTimingFloor = async (
  operationStart: number
): Promise<void> => {
  const elapsed = Date.now() - operationStart;
  const floor =
    SUBSCRIBE_TIMING_FLOOR_BASE_MS +
    Math.random() * SUBSCRIBE_TIMING_FLOOR_JITTER_MS;
  if (elapsed < floor) {
    await sleep(floor - elapsed);
  }
};

export const newsletterSubscribe_IO = async ({
  email,
  ipAddress,
  consentSource,
  locale,
}: NewsletterSubscribeInput): Promise<
  OperationResult<
    NewsletterSubscribeSuccess,
    | NewsletterAlreadySubscribedError
    | NewsletterSubscribeFailedError
    | DatabaseError
  >
> => {
  const operationStart = Date.now();
  const normalizedEmail = email.trim().toLowerCase();
  const confirmationToken = generateConfirmationToken();
  const resolvedLocale = getLocaleOrDefault(locale);

  try {
    // Check if already subscribed
    const existing = await DB_CLIENT.use.newsletterSubscriber.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        is_active: true,
        confirmed_at: true,
      },
    });

    if (existing) {
      if (existing.is_active && existing.confirmed_at) {
        // Timing-oracle mitigation (member fast-path). The same floor is applied to the fresh-subscribe success
        // return below, so both success branches land in the same [400,700)ms band; jitter prevents a
        // fixed-threshold classifier. Rationale and residual: see the comment on enforceSubscribeTimingFloor above.
        await enforceSubscribeTimingFloor(operationStart);
        return failure({ type: 'ALREADY_SUBSCRIBED' });
      }

      // Pending or previously unsubscribed — rotate token and resend confirmation email.
      // DECISION: this update (and the twin P2002-rotate below) is a bare `update({where:email})` WITHOUT a CAS
      // guard, unlike confirm/unsubscribe (where CAS dedupes consent events on double click). CAS is unnecessary
      // here: subscribe creates no consent event (it appears on confirm), and a bare update cannot revoke a
      // fresh confirmation because the new token is random (randomBytes) and unknown until the mail arrives,
      // while this op's read->write window is milliseconds. Concurrent subscribe vs unsubscribe resolves
      // correctly both ways (the unsubscribe CAS on `OR[is_active,token]` wins after a rotation and no-ops on
      // an already unsubscribed record).
      await DB_CLIENT.use.newsletterSubscriber.update({
        where: { email: normalizedEmail },
        data: {
          confirmation_token: confirmationToken,
          is_active: false,
          confirmed_at: null,
          consent_timestamp: null,
          ...(ipAddress !== undefined ? { ip_address: ipAddress } : {}),
          ...(consentSource !== undefined
            ? { consent_source: consentSource }
            : {}),
        },
      });
    } else {
      // New subscriber — pending confirmation.
      try {
        await DB_CLIENT.use.newsletterSubscriber.create({
          data: {
            email: normalizedEmail,
            is_active: false,
            confirmation_token: confirmationToken,
            ...(ipAddress !== undefined ? { ip_address: ipAddress } : {}),
            ...(consentSource !== undefined
              ? { consent_source: consentSource }
              : {}),
          },
        });
      } catch (createError) {
        // DECISION: P2002 is detected structurally (isP2002), not with instanceof (see
        // web-1/src/application/db/prisma-error.ts); a concurrent subscribe (row created between
        // findUnique and create) must become an idempotent token rotation, not SUBSCRIBE_FAILED.
        if (isP2002(createError)) {
          // Concurrent subscribe — row created between our findUnique and create.
          // Rotate token on the now-existing row (same as "pending" branch above).
          // Full parity with the pending branch: reset confirmed_at AND
          // consent_timestamp to null so both rotation paths land the row in an
          // identical clean-pending state (guards against a stale consent_timestamp
          // co-existing with confirmed_at:null if the create path ever seeds one).
          await DB_CLIENT.use.newsletterSubscriber.update({
            where: { email: normalizedEmail },
            data: {
              confirmation_token: confirmationToken,
              is_active: false,
              confirmed_at: null,
              consent_timestamp: null,
              ...(ipAddress !== undefined ? { ip_address: ipAddress } : {}),
              ...(consentSource !== undefined
                ? { consent_source: consentSource }
                : {}),
            },
          });
        } else {
          throw createError;
        }
      }
    }
  } catch (error) {
    // DECISION: a DB failure on this public consent endpoint MUST be visible. This catch covers only database
    // operations (findUnique/create/update) and used to wrap them in `SUBSCRIBE_FAILED` with
    // `reason: error.message`, a field nobody reads (the mapper returns `respondGeneralError(res, undefined)`),
    // so an outage on an unauthenticated endpoint left zero Event Log entries and no PostHog alert.
    // `databaseFailure` is the canonical path: it reports (DATABASE_ERROR namespace, stack) and returns
    // `DATABASE_ERROR`. The client contract is unchanged: both map to the same opaque 500, so the driver
    // message still does not leak.
    return databaseFailure('newsletterSubscribe_IO', error);
  }

  const confirmUrl = buildConfirmationUrl(confirmationToken, resolvedLocale);
  const sent = await sendTransactionalEmail(
    'newsletter-confirm',
    { email: normalizedEmail },
    APP_EVENTS.INFO.NEWSLETTER.NEWSLETTER_PENDING_CONFIRMATION,
    { confirmUrl },
    'email.newsletter.confirm.subject',
    resolvedLocale
  );
  if (!sent) {
    return failure({
      type: 'SUBSCRIBE_FAILED',
      reason: 'Confirmation email delivery failed',
    });
  }

  // Timing-oracle mitigation: floor the fresh-subscribe success to the same
  // [400,700)ms band as the ALREADY_SUBSCRIBED path so response time cannot
  // distinguish a member email from a non-member one (finding C1).
  await enforceSubscribeTimingFloor(operationStart);
  return success({ subscribed: true, pending_confirmation: true });
};

// Re-export the broader union for consumers that need exhaustive handling.
export type NewsletterSubscribeError = NewsletterError;
