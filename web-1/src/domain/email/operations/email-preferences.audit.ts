import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { EmailPreferenceSource } from '@kernel/domain/email/email-preferences.config';
import type { EmailPreferences } from '@kernel/models/email/email.dto';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';

/** Schedule only committed choices. Null means first capture; false is a real opt-out. */
export function scheduleEmailPreferenceAudit({
  userId,
  accountId,
  source,
  before,
  after,
}: {
  userId: string;
  accountId: string;
  source: EmailPreferenceSource;
  before: EmailPreferences | null;
  after: EmailPreferences;
}): void {
  if (
    before?.marketing === after.marketing &&
    before.trial_sequence === after.trial_sequence
  ) {
    return;
  }
  runAfterResponse(() =>
    recordAuditEvent_IO({
      eventName: APP_EVENTS.INFO.EMAIL.EMAIL_PREFERENCES_UPDATED,
      user: { id: userId },
      responseBody: {
        account_id: accountId,
        source,
        previous_preferences: before,
        preferences: after,
      },
    })
  );
}
