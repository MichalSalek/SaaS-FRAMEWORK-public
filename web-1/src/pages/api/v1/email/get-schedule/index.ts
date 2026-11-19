import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { defineEndpoint } from '@app/http/define-endpoint';
import { getEmailSchedule_IO } from '@domain/email/operations/email-query.operations';
import { EMAIL_CONTRACTS } from '@kernel/domain/email/email.contracts';

export default defineEndpoint(EMAIL_CONTRACTS.EMAIL_GET_SCHEDULE, {
  handle: async ({ ok }) => {
    const result = await getEmailSchedule_IO();
    if (!result.success) {
      return;
    }
    const data = result.data;
    // ParsedData drops `readonly`. The config objects stay frozen, so the response is a copy.
    ok(
      {
        schedule: data.schedule.map(rule => ({
          ...rule,
          personalizeWith: [...rule.personalizeWith],
        })),
        cancelSchedule: data.cancelSchedule.map(rule => ({ ...rule })),
        freeSchedule: {
          config: {
            ...data.freeSchedule.config,
            OPPORTUNITIES: [...data.freeSchedule.config.OPPORTUNITIES],
          },
          rules: {
            'free-first-photo': {
              ...data.freeSchedule.rules['free-first-photo'],
            },
            'free-public-profile': {
              ...data.freeSchedule.rules['free-public-profile'],
            },
            'free-first-client': {
              ...data.freeSchedule.rules['free-first-client'],
            },
          },
        },
      },
      APP_EVENTS.INFO.EMAIL.EMAIL_SCHEDULE_FETCHED
    );
  },
});
