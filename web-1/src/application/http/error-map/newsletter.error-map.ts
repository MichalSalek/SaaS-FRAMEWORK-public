// Newsletter errors (kernel `NewsletterError`).
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { NewsletterError } from '@kernel/domain/newsletter/newsletter-errors.types';
import {
  respondBadRequest,
  respondNotFound,
  respondSuccess,
} from '../http.responses.utils';
import type { ErrorResponderMap, OwnErrors } from './error-map.types';
import { respondOpaqueFailure } from './shared.responders';

export const newsletterErrorMap = {
  // DECISION: respond with success to prevent email enumeration; same shape as
  // pending-confirmation.
  ALREADY_SUBSCRIBED: res =>
    respondSuccess(
      res,
      { subscribed: true, pending_confirmation: true },
      APP_EVENTS.INFO.NEWSLETTER.NEWSLETTER_PENDING_CONFIRMATION
    ),

  // Subscribe failure: opaque 500, no detail exposed.
  SUBSCRIBE_FAILED: respondOpaqueFailure,

  NEWSLETTER_INVALID_TOKEN: res =>
    respondBadRequest(
      res,
      APP_EVENTS.INFO.NEWSLETTER.NEWSLETTER_INVALID_TOKEN,
      {
        reason: 'Invalid or expired newsletter confirmation token',
      }
    ),

  NEWSLETTER_UNSUBSCRIBE_NOT_FOUND: res =>
    respondNotFound(
      res,
      APP_EVENTS.INFO.NEWSLETTER.NEWSLETTER_UNSUBSCRIBE_NOT_FOUND,
      { reason: 'No newsletter subscription found for this token' }
    ),
} satisfies ErrorResponderMap<OwnErrors<NewsletterError>>;
