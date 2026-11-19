import { reportIssueBackend } from '@app/debugger/error-handler';
import { ENV_VARS } from '@app/environment/environment.config';
import { buildBetterStackHeartbeatUrl } from '@app/health/neon-compute-quota.monitor';
import { SCHEDULER_CONFIG } from './scheduler.config';

/**
 * Dead-man switch of the clock, no database access. Every tick reports to a Better Stack
 * heartbeat: success when the scheduler is healthy, `/fail` (immediate alert) when the tick
 * raises an alarm. When ticks stop arriving at all (monitor paused or deleted, Render down),
 * the pings stop and Better Stack alerts after the heartbeat's grace, also at zero traffic.
 * Feature-flagged by presence of SCHEDULER_HEARTBEAT_URL (a secret: the URL carries the token).
 */
export const pingSchedulerHeartbeat = async (
  alarm: ReadonlyArray<string>
): Promise<void> => {
  const secretUrl = ENV_VARS.SCHEDULER_HEARTBEAT_URL;
  if (!secretUrl) {
    return;
  }
  try {
    const response = await fetch(
      buildBetterStackHeartbeatUrl(secretUrl, alarm.length > 0),
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: alarm.length > 0 ? `Unhealthy jobs: ${alarm.join(', ')}` : 'ok',
        signal: AbortSignal.timeout(SCHEDULER_CONFIG.HEARTBEAT_TIMEOUT_MS),
      }
    );
    if (!response.ok) {
      throw new Error(
        `Better Stack heartbeat returned HTTP ${response.status}`
      );
    }
  } catch (error) {
    // Never forward a fetch error: runtimes may put the secret URL into its text.
    reportIssueBackend({
      namespace: 'SCHEDULER',
      message: 'Scheduler heartbeat ping failed',
      payload: {
        reason:
          error instanceof Error && error.message.startsWith('Better Stack')
            ? error.message
            : 'request failed',
      },
      mode: 'warn',
    });
  }
};
