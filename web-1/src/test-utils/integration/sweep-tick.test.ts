/**
 * Integration-handler test: the external clock /api/v1/internal/sweep-tick.
 * The scheduler is mocked: its claim/lease semantics are proven in
 * application/scheduler/*.test.ts and on real Postgres (tests/postgres/job-lease.test.ts).
 * Here: the tick answers from memory, starts a round only when told to wake, and turns an
 * alarm into a 503 without the monitor keyword plus a failing heartbeat.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mockApiHandler } from '../mockApiHandler';

const scheduler = vi.hoisted(() => ({
  decideTick: vi.fn(),
  runRound: vi.fn(async () => null),
  ping: vi.fn(async () => undefined),
  afterResponse: [] as Array<() => Promise<unknown>>,
}));

vi.mock('@app/scheduler/scheduler.instance', () => ({
  appScheduler: {
    decideTick: scheduler.decideTick,
    runRound: scheduler.runRound,
  },
}));
vi.mock('@app/scheduler/scheduler-heartbeat', () => ({
  pingSchedulerHeartbeat: scheduler.ping,
}));
vi.mock('@app/runtime/run-after-response', () => ({
  runAfterResponse: (task: () => Promise<unknown>) => {
    scheduler.afterResponse.push(task);
  },
}));

import handler from '../../pages/api/v1/internal/sweep-tick/index';

const drain = async () => {
  for (const task of scheduler.afterResponse.splice(0)) {
    await task();
  }
};

describe('GET /api/v1/internal/sweep-tick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduler.afterResponse.length = 0;
  });

  it('answers from memory and starts no round when nothing may wake the database', async () => {
    scheduler.decideTick.mockReturnValue({ wake: false, alarm: [] });
    const { status, event, data } = await mockApiHandler(handler, {
      method: 'GET',
    });
    await drain();

    expect(status).toBe(200);
    expect(event).toBe(APP_EVENTS.QUERIES.APPLICATION.INTERNAL_SWEEP_TICK);
    expect(data).toEqual({ ran: false });
    expect(scheduler.runRound).not.toHaveBeenCalled();
    expect(scheduler.ping).toHaveBeenCalledWith([]);
  });

  it('starts a tick round after the response when a waking job is due', async () => {
    scheduler.decideTick.mockReturnValue({ wake: true, alarm: [] });
    const { status, data } = await mockApiHandler(handler, { method: 'GET' });
    await drain();

    expect(status).toBe(200);
    expect(data).toEqual({ ran: true });
    expect(scheduler.runRound).toHaveBeenCalledWith('tick');
  });

  it('answers 503 without the monitor keyword and fails the heartbeat on an alarm', async () => {
    scheduler.decideTick.mockReturnValue({
      wake: true,
      alarm: ['pairing-cleanup'],
    });
    const { status, event } = await mockApiHandler(handler, { method: 'GET' });
    await drain();

    expect(status).toBe(503);
    expect(event).not.toBe(APP_EVENTS.QUERIES.APPLICATION.INTERNAL_SWEEP_TICK);
    expect(scheduler.ping).toHaveBeenCalledWith(['pairing-cleanup']);
    // The round still runs: an alarm must not stop the catch-up.
    expect(scheduler.runRound).toHaveBeenCalledWith('tick');
  });

  it('HEAD never touches the scheduler', async () => {
    const { status } = await mockApiHandler(handler, { method: 'HEAD' });
    expect(status).toBe(200);
    expect(scheduler.decideTick).not.toHaveBeenCalled();
  });
});
