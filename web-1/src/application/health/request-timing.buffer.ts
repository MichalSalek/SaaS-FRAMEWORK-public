/**
 * Circular buffer for tracking request durations (in-memory only).
 * Stores last BUFFER_SIZE request durations for avg response time calculation.
 * Resets on server restart — acceptable for ephemeral health metrics.
 */

const BUFFER_SIZE = 100;

const buffer: number[] = [];
let pointer = 0;

export const recordRequestTiming = (duration_ms: number): void => {
  if (buffer.length < BUFFER_SIZE) {
    buffer.push(duration_ms);
  } else {
    buffer[pointer] = duration_ms;
  }
  pointer = (pointer + 1) % BUFFER_SIZE;
};

export const getAverageResponseTime = (): {
  avg_response_time_ms: number;
  total_requests_tracked: number;
} => {
  // `buffer.length` is the live tracked-sample count: it grows until BUFFER_SIZE,
  // then stays pinned there as `recordRequestTiming` overwrites in place. The
  // previous `filled` flag was redundant — once the buffer was full it only ever
  // re-derived `buffer.length === BUFFER_SIZE`.
  const count = buffer.length;
  if (count === 0) {
    return { avg_response_time_ms: 0, total_requests_tracked: 0 };
  }

  const sum = buffer.reduce((acc, val) => acc + val, 0);
  return {
    avg_response_time_ms: Math.round(sum / count),
    total_requests_tracked: count,
  };
};
