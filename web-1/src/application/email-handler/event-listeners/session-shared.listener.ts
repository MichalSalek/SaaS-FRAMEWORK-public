import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { subscribeToInfoEvent } from '@app/events/event-bus';
import { DB_CLIENT } from '@app/db/db.client';
import { processEmailOutbox_IO } from '@app/email-handler/outbox/email-outbox';

// The business transaction owns the durable intent. This awaited subscriber only
// dispatches that existing row; replay never creates another send.
subscribeToInfoEvent(
  APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_SHARED,
  async payload => {
    const row = await DB_CLIENT.use.emailLifecycleMessage.findFirst({
      where: {
        accountId: payload.stylistAccountId,
        ruleId: 'session-shared',
        occurrence: payload.sessionId,
        outbox: true,
      },
      select: { id: true },
    });
    if (!row) {
      throw new Error('Committed session email intent missing');
    }
    const result = await processEmailOutbox_IO({ ids: [row.id] });
    if (result.deadLettered > 0) {
      throw new Error('Session email delivery needs intervention');
    }
  }
);
