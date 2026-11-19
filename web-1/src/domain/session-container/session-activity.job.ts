import { TIME } from '@kernel/application/constants.config';
import { defineScheduledJob } from '@app/scheduler/scheduled-job';
import { processSessionActivityOutbox_IO } from './session-activity.outbox';

export const sessionActivityOutboxJob = defineScheduledJob({
  name: 'session-activity-outbox',
  wakesOnTick: true,
  intervalMs: 30 * TIME.MS_PER_MINUTE,
  run: async () => {
    const result = await processSessionActivityOutbox_IO();
    if (result.failed > 0) {
      throw new Error(
        `Session activity delivery incomplete: ${result.failed} failed attempts`
      );
    }
  },
});
