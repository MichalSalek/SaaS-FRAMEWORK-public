/**
 * Mailgun Daily Request-Cap Breaker — daily quota protection.
 *
 * Distinct concern from `email-circuit-breaker.ts` (which guards the sending
 * DOMAIN REPUTATION by polling the Mailgun Events API for the 24h hard-bounce
 * rate). THIS breaker guards the DAILY REQUEST CAP: Mailgun counts
 * every API/SMTP REQUEST (not just delivered messages) against a hard daily
 * limit and, once exceeded, hard-fails EVERY further request with
 * `429 "daily request limit exceeded, try again after <reset>"` until the cap
 * resets the next day.
 *
 * Without a breaker, the retry × SMTP-fallback × lifecycle-sweep fan-out keeps
 * hammering a guaranteed-to-fail endpoint — observed ~193 requests for 5 emails
 * during one capped day, deepening the exhaustion and burning the next day's
 * budget on pointless retries.
 *
 * DECISION (nie usuwaj tego komentarza):
 * State machine is deliberately trivial (one timestamp), NOT the 3-state poll
 * machine of email-circuit-breaker.ts. The daily cap is a hard binary fact the
 * provider hands us — including the exact reset time — so there is nothing to
 * poll, sample, or smooth. We record the reset, fail-fast every send until then,
 * and auto-close at the reset. State is in-process; a multi-pod deployment would
 * move it to a shared store, same as the bounce-rate breaker's documented
 * migration path.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Detection requires BOTH `status === 429` AND a "daily limit" phrase. A bare 429
 * is ALSO Mailgun's transient per-second/per-minute rate-limit, which recovers in
 * seconds — tripping a day-long breaker on that would wrongly suppress sends. The
 * daily-cap message is the only 429 that justifies short-circuiting until a reset.
 */

import { TIME } from '@kernel/application/constants.config';
import { reportIssueBackend } from '@app/debugger/error-handler';
// Barrel import (admin.dto re-exports admin-health.dto) — matches the sibling
// email-circuit-breaker.ts convention so the two stay refactor-aligned.
import type { MailgunDailyLimitInfo } from '@kernel/models/admin/admin.dto';

/**
 * Fallback suppression window when the provider's reset time is missing or
 * unparseable. Bounded + short on purpose: re-probe periodically rather than
 * risk locking sends out for a misparsed full day. Worst case while genuinely
 * capped: one wasted request per window (~48/day) — not a storm.
 */
const DAILY_LIMIT_FALLBACK_MINUTES = 30;

/**
 * Upper bound on a trusted provider reset time. A genuine daily cap
 * always resets within 24h, so any parsed reset beyond this is treated as a
 * misparse and replaced by the bounded fallback window (see tripMailgunDailyLimit).
 * Guards against a finite-but-wrong Date.parse result (the format is
 * implementation-defined for non-ISO/RFC-2822 strings) locking sends out for days.
 */
const DAILY_LIMIT_MAX_RESET_HOURS = 25;

// ── In-memory state ─────────────────────────────────────────────────────────

/** Epoch ms at which the daily cap is expected to reset; null = breaker closed. */
let _resetAt: number | null = null;

/** Log the trip exactly ONCE per incident (not on every blocked send). */
let _tripLogged = false;

// ── Detection ───────────────────────────────────────────────────────────────

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};

/**
 * Parse Mailgun's "...try again after Tue, 16 Jun 2026 07:32:33 UTC" suffix into
 * epoch ms. Returns null when absent or unparseable (caller falls back to a
 * bounded window).
 */
const parseResetAt = (details: string): number | null => {
  const match = details.match(/try again after\s+(.+?)\s*$/i);
  const captured = match?.[1];
  if (!captured) {
    return null;
  }
  const parsed = Date.parse(captured);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Classify an error thrown by the Mailgun adapter. Only the daily-cap 429 (not a
 * transient rate-limit 429) reports `isDailyLimit: true`.
 */
export const detectMailgunDailyLimit = (
  error: unknown
): { isDailyLimit: boolean; resetAtMs: number | null } => {
  const record = asRecord(error);
  const status = typeof record.status === 'number' ? record.status : undefined;
  const details = typeof record.details === 'string' ? record.details : '';
  const message = typeof record.message === 'string' ? record.message : '';
  const haystack = `${details} ${message}`.toLowerCase();

  const isDailyLimit =
    status === 429 && haystack.includes('daily') && haystack.includes('limit');

  if (!isDailyLimit) {
    return { isDailyLimit: false, resetAtMs: null };
  }
  return { isDailyLimit: true, resetAtMs: parseResetAt(details) };
};

// ── Trip / query ────────────────────────────────────────────────────────────

/**
 * Open the breaker until the cap resets. Idempotent: a second 429 carrying a
 * fresher reset extends (never shortens) the window. Logs once per incident.
 */
export const tripMailgunDailyLimit = (resetAtMs: number | null): void => {
  const now = Date.now();
  const fallback = now + DAILY_LIMIT_FALLBACK_MINUTES * TIME.MS_PER_MINUTE;
  const ceiling = now + DAILY_LIMIT_MAX_RESET_HOURS * TIME.MS_PER_HOUR;
  // Explicit bounds check (NOT truthiness): Date.parse can legitimately yield 0
  // (Unix epoch), which `resetAtMs && …` would wrongly treat as "unparsed".
  // The upper ceiling rejects an implausibly-far-future misparse that would
  // otherwise lock sends out for days (a real daily cap always resets <24h);
  // such a value falls back to the bounded re-probe window instead.
  const withinSaneWindow =
    resetAtMs !== null && resetAtMs > now && resetAtMs <= ceiling;
  const candidate = withinSaneWindow ? resetAtMs : fallback;

  _resetAt =
    _resetAt && _resetAt > now ? Math.max(_resetAt, candidate) : candidate;

  if (!_tripLogged) {
    _tripLogged = true;
    reportIssueBackend({
      namespace: 'MAILGUN_DAILY_LIMIT_TRIPPED',
      message: `Mailgun daily request cap hit — short-circuiting email sends until ${new Date(
        _resetAt
      ).toISOString()}. Daily quota exhausted; retries suppressed to avoid storming the provider.`,
      payload: {
        reset_at: new Date(_resetAt).toISOString(),
        parsed_from_provider: resetAtMs !== null,
      },
      mode: 'warn',
    });
  }
};

/**
 * True while the daily cap is in effect. Auto-closes (and re-arms the one-shot
 * log) once the reset time passes, so the next send probes the provider again.
 */
export const isMailgunDailyLimited = (): boolean => {
  if (_resetAt === null) {
    return false;
  }
  if (Date.now() >= _resetAt) {
    _resetAt = null;
    _tripLogged = false;
    return false;
  }
  return true;
};

/**
 * Detect-and-trip in one call for adapter catch blocks: classify the error and,
 * if it is the daily cap, open the breaker. Returns true when the error WAS the
 * daily-cap 429 (caller may keep its existing re-throw behavior either way).
 */
export const noteMailgunErrorForDailyLimit = (error: unknown): boolean => {
  const { isDailyLimit, resetAtMs } = detectMailgunDailyLimit(error);
  if (isDailyLimit) {
    tripMailgunDailyLimit(resetAtMs);
  }
  return isDailyLimit;
};

/** Admin /health snapshot — no PII, just the cap state + reset time. */
export const getMailgunDailyLimitInfo = (): MailgunDailyLimitInfo => {
  const limited = isMailgunDailyLimited();
  return {
    limited,
    reset_at: limited && _resetAt ? new Date(_resetAt).toISOString() : null,
  };
};

/** Test-only: clear breaker state between cases. */
export const __resetMailgunDailyLimitForTest = (): void => {
  _resetAt = null;
  _tripLogged = false;
};
