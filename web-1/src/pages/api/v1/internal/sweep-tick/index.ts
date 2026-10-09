import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { PUBLIC_DTO_API_V1 } from '@kernel/models/public/public.dto';
import { withRateLimitCheck } from '@app/http/rate-limit.middleware';
import { withPublicHandler } from '@app/http/define-raw-handler';
import { isSweepTickDue } from '@app/email-handler/email-lifecycle.state';
import { runMaintenanceSweeps } from '@app/interceptors/schedule-maintenance-sweeps';

type TickResponse = PUBLIC_DTO_API_V1['INTERNAL_SWEEP_TICK']['RESPONSE'];

// DECISION (nie usuwaj tego komentarza):
// External clock for the maintenance sweeps, called by a Better Stack monitor
// (owner decision 2026-09-23; rationale at ROUTES_API.INTERNAL_SWEEP_TICK).
// The tick touches Postgres only when the lifecycle-mail sweep is due (its own
// 6 h throttle) and outside mail quiet hours; every other call answers from
// memory, so a monitor polling every few minutes keeps Neon's scale-to-zero.
// When due, it starts the same sweep set as the traffic path
// (runMaintenanceSweeps); each sweep keeps its own throttle and dedup.
// GET/HEAD like health-public, because that is what uptime monitors send.
export default withPublicHandler({
  allowedMethods: ['GET'],
  cors: false,
  rateLimit: false,
  handle: async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      res
        .status(405)
        .json({ event: APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO });
      return;
    }

    if (!withRateLimitCheck(req, res)) {
      return;
    }

    if (req.method === 'HEAD') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(200).end();
      return;
    }

    const ran = isSweepTickDue();
    if (ran) {
      runMaintenanceSweeps();
    }

    const data: TickResponse = { ran };
    res.status(200).json({
      event: APP_EVENTS.QUERIES.APPLICATION.INTERNAL_SWEEP_TICK,
      data,
    });
  },
});
