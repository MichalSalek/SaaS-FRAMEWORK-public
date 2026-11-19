import { lockStylistAccount } from '@app/db/lock-rows';
import { recordLifecycleUnsubscriptionTx } from '@app/email-handler/lifecycle/operational-decision';
/**
 * Email Preferences Operations
 *
 * SRP: Update email preferences for a user's StylistAccount.
 * Domain operation with I/O (DB access).
 */

import type { EmailPreferenceSource } from '@kernel/domain/email/email-preferences.config';
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
import { scheduleEmailPreferenceAudit } from './email-preferences.audit';
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
  preferences: { trial_sequence: boolean; marketing: boolean },
  source: EmailPreferenceSource = 'unspecified'
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

  // DECISION: dual-write the typed columns and the JSON shadow; see trial-account.send.ts.
  // DECISION: a separate try/catch for the update (parity with email-unsubscribe.operations.ts):
  // P2025 (account deleted between findFirst and update) must map to EMAIL_USER_NOT_FOUND (404),
  // not to a generic databaseFailure (500).
  try {
    const previous = await DB_CLIENT.use.$transaction(async tx => {
      await lockStylistAccount(tx, account.account_id);
      const before = await tx.stylistAccount.findUniqueOrThrow({
        where: { account_id: account.account_id },
        select: { email_trial_sequence: true, email_marketing: true },
      });
      await tx.stylistAccount.update({
        where: { account_id: account.account_id },
        data: {
          email_preferences: updatedPrefs,
          email_marketing: preferences.marketing,
          email_trial_sequence: preferences.trial_sequence,
        },
      });
      if (before.email_trial_sequence && !preferences.trial_sequence) {
        await recordLifecycleUnsubscriptionTx(
          tx,
          userId,
          account.account_id,
          'TRIAL_SEQUENCE'
        );
      }
      if (before.email_marketing && !preferences.marketing) {
        await recordLifecycleUnsubscriptionTx(
          tx,
          userId,
          account.account_id,
          'MARKETING'
        );
      }
      if (!preferences.trial_sequence) {
        await tx.freeEmailEnrollment.updateMany({
          where: { accountId: account.account_id, status: 'active' },
          data: {
            status: 'finished',
            finishReason: 'unsubscribed',
            finishedAt: new Date(),
          },
        });
      }
      return {
        trial_sequence: before.email_trial_sequence,
        marketing: before.email_marketing,
      };
    });
    scheduleEmailPreferenceAudit({
      userId,
      accountId: account.account_id,
      source,
      before: previous,
      after: updatedPrefs,
    });
  } catch (error) {
    if (isP2025(error)) {
      return failure({ type: 'EMAIL_USER_NOT_FOUND', userId });
    }
    return databaseFailure('updateEmailPreferences_IO', error);
  }

  // 4. Return success
  return success({ preferences: updatedPrefs });
};
