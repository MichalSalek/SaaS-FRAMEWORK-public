/**
 * EMAIL LIFECYCLE STATE (In-Memory)
 *
 * Tracks last sweep timestamp to trigger sweep once per 6h.
 * State is per-instance (multiple instances = multiple sweeps, which is OK
 * because EventLog dedup prevents duplicate emails).
 *
 * Pattern: 1:1 with pairing-cleanup-state.ts
 */

import { EMAIL_LIFECYCLE_CONFIG } from '@kernel/domain/email/email-schedule.config';

let _lastSweepTimestamp = 0; // Unix timestamp (ms), private: read through shouldRunEmailSweep

export const updateLastSweepTimestamp = (): void => {
  _lastSweepTimestamp = Date.now();
};

export const shouldRunEmailSweep = (): boolean =>
  Date.now() - _lastSweepTimestamp > EMAIL_LIFECYCLE_CONFIG.SWEEP_THROTTLE_MS;

/** Quiet hours (21:00-09:00 UTC): no lifecycle mail goes out. */
export const isEmailQuietHours = (now: Date = new Date()): boolean => {
  const hour = now.getUTCHours();
  return (
    hour >= EMAIL_LIFECYCLE_CONFIG.QUIET_HOURS_START ||
    hour < EMAIL_LIFECYCLE_CONFIG.QUIET_HOURS_END
  );
};

/**
 * The external clock (internal/sweep-tick) wakes the database only when the
 * mail sweep is due by its own throttle and mail may go out right now.
 */
export const isSweepTickDue = (now: Date = new Date()): boolean =>
  shouldRunEmailSweep() && !isEmailQuietHours(now);

/**
 * In-flight guard. The 6h stamp is written only AFTER a successful sweep (so a
 * failed one retries on the next request), which leaves a window where two
 * overlapping requests both pass `shouldRunEmailSweep`. The per-step EventLog
 * dedup is read -> send -> insert, NOT atomic, so two concurrent sweeps could
 * both send the same mail (S122 review). One sweep at a time per process.
 * Kept on globalThis: a module bundled twice (instrumentation vs pages/api)
 * would otherwise hold two independent flags (see AGENTS.md, double bundle).
 */
const IN_FLIGHT_KEY = Symbol.for('nailfolio.emailLifecycleSweepInFlight');
type SweepFlagHolder = { [IN_FLIGHT_KEY]?: boolean };

export const tryBeginEmailSweep = (): boolean => {
  const holder = globalThis as SweepFlagHolder;
  if (holder[IN_FLIGHT_KEY] === true) {
    return false;
  }
  holder[IN_FLIGHT_KEY] = true;
  return true;
};

export const endEmailSweep = (): void => {
  (globalThis as SweepFlagHolder)[IN_FLIGHT_KEY] = false;
};
