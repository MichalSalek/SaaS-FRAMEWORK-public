import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type {
  NewsletterInvalidTokenError,
  NewsletterUnsubscribeNotFoundError,
} from '@kernel/domain/newsletter/newsletter-errors.types';
import { NEWSLETTER_CONSENT_ACTION } from '@kernel/domain/newsletter/newsletter-consent.types';
import { verifyNewsletterUnsubscribeToken } from '@app/email-handler/newsletter-unsubscribe.token';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { markSubscriberUnsubscribedInAudience } from '@app/email-handler/newsletter-audience';
import { runAfterResponse } from '@app/runtime/run-after-response';

type NewsletterUnsubscribeSuccess = {
  unsubscribed: true;
  already_unsubscribed?: boolean;
};

type NewsletterConsentClientInfo = {
  ipAddress?: string;
  userAgent?: string;
};

export const newsletterUnsubscribe_IO = async (
  token: string,
  clientInfo: NewsletterConsentClientInfo = {}
): Promise<
  OperationResult<
    NewsletterUnsubscribeSuccess,
    // DECISION: NewsletterUnsubscribeNotFoundError stays in the error union although the op no longer returns it
    // (a valid HMAC for a non-subscriber yields an idempotent 200, anti-enumeration, see below). The type stays
    // because the handler has a defensive branch on 'NEWSLETTER_UNSUBSCRIBE_NOT_FOUND' (narrowing the union
    // would break its typing, TS2367) and it reserves the mapping of a real P2025 race (record deleted between
    // findUnique and the transaction).
    | NewsletterInvalidTokenError
    | NewsletterUnsubscribeNotFoundError
    | DatabaseError
  >
> => {
  const decoded = verifyNewsletterUnsubscribeToken(token);
  if (!decoded) {
    return failure({ type: 'NEWSLETTER_INVALID_TOKEN' });
  }

  const normalizedEmail = decoded.email.trim().toLowerCase();

  let subscriber: {
    id: string;
    is_active: boolean;
    confirmation_token: string | null;
  } | null;
  try {
    subscriber = await DB_CLIENT.use.newsletterSubscriber.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, is_active: true, confirmation_token: true },
    });
  } catch (error) {
    return databaseFailure('newsletterUnsubscribe_IO.findUnique', error);
  }

  if (!subscriber) {
    // DECISION: a valid HMAC token for an address that is NOT a subscriber returns an IDEMPOTENT success, not a
    // 400 NOT_FOUND. The token is signed with a server-only secret (timingSafeEqual, forging is infeasible), so
    // the link holder gains nothing, and a uniform 200 removes the 200-vs-400 oracle that would reveal whether
    // an address is on the list. Same as the sibling processUnsubscribe_IO (email-unsubscribe). Nothing is written.
    return success({ unsubscribed: true, already_unsubscribed: true });
  }

  if (!subscriber.is_active && subscriber.confirmation_token === null) {
    return success({ unsubscribed: true, already_unsubscribed: true });
  }

  // Only a CONFIRMED (active) subscriber was ever synced to the Resend audience
  // (confirm is the sole add path). Capture that BEFORE the soft-disable flips the
  // flag, so a pending unsubscribe skips a guaranteed-no-op audience call + its warn.
  const wasActive = subscriber.is_active;

  let didUnsubscribe: boolean;
  try {
    didUnsubscribe = await DB_CLIENT.use.$transaction(async tx => {
      const updated = await tx.newsletterSubscriber.updateMany({
        where: {
          id: subscriber.id,
          // CAS: tylko writer, ktory wciaz zastaje rekord w stanie do-wypisu, wygrywa.
          OR: [{ is_active: true }, { confirmation_token: { not: null } }],
        },
        data: {
          is_active: false,
          // Invalidate any pending confirmation tokens so an unsubscribed user
          // cannot accidentally re-activate via a stale link.
          confirmation_token: null,
        },
      });

      if (updated.count === 0) {
        return false; // concurrent unsubscribe already withdrew — no duplicate consent event
      }

      await tx.newsletterConsentEvent.create({
        data: {
          newsletter_id: subscriber.id,
          action: NEWSLETTER_CONSENT_ACTION.UNSUBSCRIBE,

          ...(clientInfo.ipAddress !== undefined
            ? { ip_address: clientInfo.ipAddress }
            : {}),
          ...(clientInfo.userAgent !== undefined
            ? { user_agent: clientInfo.userAgent }
            : {}),
        },
      });
      return true;
    });
  } catch (error) {
    return databaseFailure('newsletterUnsubscribe_IO.transaction', error);
  }

  // Withdrawal recorded in DB (SSOT) → desync from the Resend broadcast audience
  // (mark unsubscribed, suppression-preserving). Deferred via runAfterResponse (NOT
  // awaited): the withdrawal is already committed, and blocking the response would
  // hurt both the email-link GET and the RFC 8058 one-click POST (mail providers
  // enforce tight timeouts on that endpoint). Best-effort/never-throws. Skipped for
  // a pending subscriber (never confirmed = never synced to the list) and when a
  // concurrent writer already performed the withdrawal (didUnsubscribe=false).
  if (wasActive && didUnsubscribe) {
    runAfterResponse(() =>
      markSubscriberUnsubscribedInAudience(normalizedEmail)
    );
  }

  return success({ unsubscribed: true });
};
