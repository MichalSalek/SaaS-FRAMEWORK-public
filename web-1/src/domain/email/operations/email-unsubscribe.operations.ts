import { lockStylistAccount } from '@app/db/lock-rows';
import { recordLifecycleUnsubscriptionTx } from '@app/email-handler/lifecycle/operational-decision';
/**
 * Email Unsubscribe Operations
 *
 * SRP: Process unsubscribe requests via HMAC-signed token.
 * Domain operation with I/O (DB access).
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  type OperationResult,
  success,
  failure,
} from '@kernel/application/result.types';
import type { EmailCategory } from '@kernel/domain/email/email-schedule.config';
import { EMAIL_LIFECYCLE_CONFIG } from '@kernel/domain/email/email-schedule.config';
import { TIME } from '@kernel/application/constants.config';
import type { EmailPreferences } from '@kernel/models/email/email.dto';
import type {
  EmailInvalidUnsubscribeTokenError,
  EmailUnsubscribeTokenExpiredError,
  EmailUserNotFoundError,
  EmailTransactionalNotUnsubscribableError,
} from '@kernel/domain/email/email-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { DB_CLIENT } from '@app/db/db.client';
import { isP2025 } from '@app/db/prisma-error';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { verifyUnsubscribeToken } from '@app/email-handler/email-unsubscribe.token';
import { databaseFailure } from '@app/errors/error-result.helpers';

/**
 * Process an unsubscribe request.
 *
 * 1. HMAC verify token
 * 2. Check TTL
 * 3. Fetch StylistAccount
 * 4. Update email_preferences JSON
 * 5. Push EventLog
 * 6. Return success
 */
export const processUnsubscribe_IO = async (
  token: string
): Promise<
  OperationResult<
    { category: EmailCategory; already_unsubscribed?: boolean },
    | EmailInvalidUnsubscribeTokenError
    | EmailUnsubscribeTokenExpiredError
    | EmailUserNotFoundError
    | EmailTransactionalNotUnsubscribableError
    | DatabaseError
  >
> => {
  // 1. Verify token
  const decoded = verifyUnsubscribeToken(token);
  if (!decoded) {
    return failure({ type: 'EMAIL_INVALID_UNSUBSCRIBE_TOKEN' });
  }

  // 2. Check TTL — both bounds.
  const tokenAgeDays = (Date.now() - decoded.timestamp) / TIME.MS_PER_DAY;

  // 2a. Future-dated token (negative age) = forged/tampered, NOT a real expired link.
  // DECISION: a token cannot have timestamp > now (generateHmacToken stamps Date.now()), so a
  // negative age means tampering, not expiry: reject as INVALID before touching the DB. HMAC alone
  // does not cover it. verifyHmacToken has the same `age < 0` guard only when given ttlMs, which
  // verifyUnsubscribeToken does not pass, so the lower bound is enforced here.
  if (tokenAgeDays < 0) {
    return failure({ type: 'EMAIL_INVALID_UNSUBSCRIBE_TOKEN' });
  }

  // 2b. Expired token (older than TTL) = legitimate link past its validity window.
  if (tokenAgeDays > EMAIL_LIFECYCLE_CONFIG.UNSUBSCRIBE_TOKEN_TTL_DAYS) {
    return failure({ type: 'EMAIL_UNSUBSCRIBE_TOKEN_EXPIRED' });
  }

  // 2c. Resolve the preference key for this category.
  // TRANSACTIONAL has no preference key (cannot be unsubscribed — PKE compliance).
  // DECISION: TRANSACTIONAL returns an explicit domain error instead of a silent success, so the
  // handler never answers `unsubscribed: true` for a no-op. The server never issues TRANSACTIONAL
  // tokens and HMAC forging is infeasible, so this is an edge path, but the answer must be true.
  const prefKey = getCategoryPrefKey(decoded.category);
  if (prefKey === null) {
    return failure({
      type: 'EMAIL_TRANSACTIONAL_NOT_UNSUBSCRIBABLE',
      category: decoded.category,
    });
  }

  // 3. Fetch StylistAccount by user ID
  // Reads the typed columns; JSON email_preferences is a shadow (see trial-account.send.ts).
  let account;
  try {
    account = await DB_CLIENT.use.stylistAccount.findFirst({
      where: { created_by_user_id: decoded.userId },
      select: {
        account_id: true,
        email_marketing: true,
        email_trial_sequence: true,
      },
    });
  } catch (error) {
    return databaseFailure('processUnsubscribe_IO:fetchAccount', error);
  }

  if (!account) {
    // DECISION: no StylistAccount for the userId of a valid HMAC token returns an idempotent success,
    // not 404. The token cannot be forged, and a uniform 200 removes the oracle on account existence
    // and preference state. Nothing is written or logged. EMAIL_USER_NOT_FOUND stays for the P2025
    // race in the UPDATE (account deleted between fetch and update).
    return success({ category: decoded.category, already_unsubscribed: true });
  }

  // 4. Build current preferences directly from Boolean columns (no JSON parse)
  const currentPrefs: EmailPreferences = {
    trial_sequence: account.email_trial_sequence,
    marketing: account.email_marketing,
  };

  // 4b. Idempotency: if already unsubscribed from this category, return success.
  // DECISION: re-clicking a valid link (pref already false) returns success({already_unsubscribed}),
  // not a 400, like newsletterUnsubscribe_IO: idempotent, and no 200-vs-400 oracle on the current
  // preference state. The redundant DB write is skipped.
  if (currentPrefs[prefKey] === false) {
    if (prefKey === 'trial_sequence') {
      try {
        await DB_CLIENT.use.freeEmailEnrollment.updateMany({
          where: { accountId: account.account_id, status: 'active' },
          data: {
            status: 'finished',
            finishReason: 'unsubscribed',
            finishedAt: new Date(),
          },
        });
      } catch (error) {
        return databaseFailure('processUnsubscribe_IO:closeFree', error);
      }
    }
    return success({ category: decoded.category, already_unsubscribed: true });
  }

  // Update the preference (prefKey is non-null here — TRANSACTIONAL rejected above)
  let updatedPrefs: EmailPreferences = {
    ...currentPrefs,
    [prefKey]: false,
  };
  let previousPrefs = currentPrefs;

  try {
    await DB_CLIENT.use.$transaction(async tx => {
      await lockStylistAccount(tx, account.account_id);
      const before = await tx.stylistAccount.findUniqueOrThrow({
        where: { account_id: account.account_id },
        select: { email_trial_sequence: true, email_marketing: true },
      });
      previousPrefs = {
        trial_sequence: before.email_trial_sequence,
        marketing: before.email_marketing,
      };
      updatedPrefs = {
        trial_sequence: before.email_trial_sequence,
        marketing: before.email_marketing,
        [prefKey]: false,
      };
      await tx.stylistAccount.update({
        where: { account_id: account.account_id },
        data: {
          email_preferences: updatedPrefs,
          email_marketing: updatedPrefs.marketing,
          email_trial_sequence: updatedPrefs.trial_sequence,
        },
      });
      if (
        (prefKey === 'trial_sequence' && before.email_trial_sequence) ||
        (prefKey === 'marketing' && before.email_marketing)
      ) {
        await recordLifecycleUnsubscriptionTx(
          tx,
          decoded.userId,
          account.account_id,
          decoded.category === 'TRIAL_SEQUENCE' ? 'TRIAL_SEQUENCE' : 'MARKETING'
        );
      }
      if (prefKey === 'trial_sequence') {
        await tx.freeEmailEnrollment.updateMany({
          where: { accountId: account.account_id, status: 'active' },
          data: {
            status: 'finished',
            finishReason: 'unsubscribed',
            finishedAt: new Date(),
          },
        });
      }
    });
  } catch (error) {
    if (isP2025(error)) {
      return failure({ type: 'EMAIL_USER_NOT_FOUND', userId: decoded.userId });
    }
    return databaseFailure('processUnsubscribe_IO', error);
  }

  // 5. Push EventLog. runAfterResponse: on Vercel, waitUntil() keeps the lambda until the task finishes.
  runAfterResponse(() =>
    recordAuditEvent_IO({
      eventName: APP_EVENTS.INFO.EMAIL.EMAIL_UNSUBSCRIBE_SUCCESS,
      user: { id: decoded.userId },
      responseBody: {
        category: decoded.category,
        source: 'unsubscribe_link',
        previous_preferences: previousPrefs,
        preferences: updatedPrefs,
      },
    })
  );

  // 6. Return success
  return success({ category: decoded.category });
};

/**
 * Map EmailCategory to EmailPreferences key.
 * TRANSACTIONAL cannot be unsubscribed.
 */
const getCategoryPrefKey = (
  category: EmailCategory
): keyof EmailPreferences | null => {
  switch (category) {
    case 'TRIAL_SEQUENCE':
      return 'trial_sequence';
    case 'MARKETING':
      return 'marketing';
    case 'TRANSACTIONAL':
      return null; // Cannot unsubscribe from transactional
    default: {
      const _exhaustive: never = category;
      void _exhaustive;
      return null;
    }
  }
};
