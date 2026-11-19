import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { PUBLIC_DTO_API_V1 } from '@kernel/models/public/public.dto';
import { withRateLimitCheck } from '@app/http/rate-limit.middleware';
import { withPublicHandler } from '@app/http/define-raw-handler';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { appScheduler } from '@app/scheduler/scheduler.instance';
import { pingSchedulerHeartbeat } from '@app/scheduler/scheduler-heartbeat';

type TickResponse = PUBLIC_DTO_API_V1['INTERNAL_SWEEP_TICK']['RESPONSE'];

// DECISION: the ONE clock of the periodic jobs, called by a Better Stack monitor (owner D11; rationale
// at ROUTES_API.INTERNAL_SWEEP_TICK and in application/scheduler/scheduled-jobs.registry.ts). The
// decision is taken from process memory, so a tick with nothing due never touches Postgres and Neon
// keeps scaling to zero; when a job that may wake the database is due (and outside mail quiet hours)
// it starts a scheduler round after the response. Every run goes through the durable JobLease claim,
// so concurrent ticks, traffic and a second instance cannot double a run.
// Alarm: when a job is still late or failing although a round already ran past its deadline, the tick
// answers 503 WITHOUT the INTERNAL_SWEEP_TICK keyword, so the keyword monitor alerts; the heartbeat
// (SCHEDULER_HEARTBEAT_URL) gets `/fail`. A tick that stops arriving is caught by that heartbeat.
// GET/HEAD like health-public, because that is what uptime monitors send. (owner, D11)
export default withPublicHandler({
  allowedMethods: ['GET', 'HEAD'],
  cors: false,
  rateLimit: false,
  handle: async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (!withRateLimitCheck(req, res)) {
      return;
    }

    if (req.method === 'HEAD') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(200).end();
      return;
    }

    const decision = appScheduler.decideTick();
    if (decision.wake) {
      runAfterResponse(() => appScheduler.runRound('tick'));
    }
    runAfterResponse(() => pingSchedulerHeartbeat(decision.alarm));

    if (decision.alarm.length > 0) {
      res
        .status(503)
        .json({ event: APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR });
      return;
    }

    const data: TickResponse = { ran: decision.wake };
    res.status(200).json({
      event: APP_EVENTS.QUERIES.APPLICATION.INTERNAL_SWEEP_TICK,
      data,
    });
  },
});
