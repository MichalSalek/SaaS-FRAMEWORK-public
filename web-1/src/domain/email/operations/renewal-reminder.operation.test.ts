import { describe, expect, it } from 'vitest';
import { SubscriptionStatusValue } from '@kernel/models/db_models.generated.dto';
import { renewalReminderExcludedStatuses } from './renewal-reminder.operation';

describe('renewalReminderExcludedStatuses', () => {
  it('keeps trialing accounts out of the renewal reminder', () => {
    expect(renewalReminderExcludedStatuses).toContain(
      SubscriptionStatusValue.TRIALING
    );
    expect(renewalReminderExcludedStatuses).toContain(
      SubscriptionStatusValue.CANCELED
    );
  });
});
