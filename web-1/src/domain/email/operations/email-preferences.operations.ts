/**
 * Email Preferences Operations
 *
 * SRP: Update email preferences for a user's StylistAccount.
 * Domain operation with I/O (DB access).
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  type OperationResult,
  success,
  failure,
} from '@kernel/application/result.types';
import type { EmailPreferences } from '@kernel/models/email/email.dto';
import type { EmailUserNotFoundError } from '@kernel/domain/email/email-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { DB_CLIENT } from '@app/db/db.client';
import { isP2025 } from '@app/db/prisma-error';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { databaseFailure } from '@app/errors/error-result.helpers';

/**
 * Update email preferences for a user.
 *
 * 1. Find StylistAccount by userId
 * 2. Update email_preferences JSON
 * 3. Push EventLog EMAIL_PREFERENCES_UPDATED
 * 4. Return success with updated preferences
 */
export const updateEmailPreferences_IO = async (
  userId: string,
  preferences: { trial_sequence: boolean; marketing: boolean }
): Promise<
  OperationResult<
    { preferences: EmailPreferences },
    EmailUserNotFoundError | DatabaseError
  >
> => {
  // 1. Find StylistAccount by user ID
  let account;
  try {
    account = await DB_CLIENT.use.stylistAccount.findFirst({
      where: { created_by_user_id: userId },
      select: {
        account_id: true,
      },
    });
  } catch (error) {
    return databaseFailure('updateEmailPreferences_IO:fetchAccount', error);
  }

  if (!account) {
    return failure({
      type: 'EMAIL_USER_NOT_FOUND',
      userId,
    });
  }

  // 2. Update email_preferences JSON
  const updatedPrefs: EmailPreferences = {
    trial_sequence: preferences.trial_sequence,
    marketing: preferences.marketing,
  };

  // DECISION (PRMA email_preferences Phase 2, 2026-05-27):
  // Reads z typed Boolean columns (email_marketing, email_trial_sequence).
  // JSON `email_preferences` zachowany jako shadow dla rollback safety.
  // Phase 3 (separate PR) — drop JSON column po zweryfikowaniu zero rollback need.
  // DECISION (nie usuwaj tego komentarza):
  // Osobny try-catch dla update (parytet z email-unsubscribe.operations.ts): P2025
  // (account usuniety miedzy findFirst a update — TOCTOU) musi mapowac na
  // EMAIL_USER_NOT_FOUND, nie na generyczny databaseFailure. Race rzadki, ale
  // bez tego splitu zwracalibysmy mylacy 500 zamiast 404.
  try {
    await DB_CLIENT.use.stylistAccount.update({
      where: { account_id: account.account_id },
      data: {
        email_preferences: updatedPrefs,
        email_marketing: preferences.marketing,
        email_trial_sequence: preferences.trial_sequence,
      },
    });
  } catch (error) {
    if (isP2025(error)) {
      return failure({ type: 'EMAIL_USER_NOT_FOUND', userId });
    }
    return databaseFailure('updateEmailPreferences_IO', error);
  }

  // 3. Push EventLog — runAfterResponse: na Vercel waitUntil() trzyma lambda do końca tasku.
  runAfterResponse(() =>
    recordAuditEvent_IO({
      eventName: APP_EVENTS.INFO.EMAIL.EMAIL_PREFERENCES_UPDATED,
      user: { id: userId },
      responseBody: {
        preferences: updatedPrefs,
      },
    })
  );

  // 4. Return success
  return success({ preferences: updatedPrefs });
};
