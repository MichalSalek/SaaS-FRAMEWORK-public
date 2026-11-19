/** Precharge reminders are disabled; failed-payment and dunning recovery emails remain enabled. */
const DISABLED_PRECHARGE_REMINDERS: ReadonlySet<string> = new Set([
  'trial-warning',
  'trial-last-day',
  'renewal-reminder',
]);

export const isPrechargeReminderDisabled = (templateId: string): boolean =>
  DISABLED_PRECHARGE_REMINDERS.has(templateId);
