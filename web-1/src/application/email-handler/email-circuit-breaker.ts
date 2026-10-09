/**
 * Email Circuit Breaker — Mailgun Bounce-Rate Protection
 *
 * Queries Mailgun Events API for failed/bounced sends in a 24h sliding window,
 * calculates the hard-bounce rate and manages a 3-state circuit breaker to
 * protect Mailgun sending domain reputation.
 *
 * State machine:
 *   CLOSED  → bounce rate < 3%   — sending fully enabled
 *   WARNING → bounce rate 3–<5%  — admin alerted, sending continues
 *   OPEN    → bounce rate ≥ 5%   — non-critical sends blocked
 *
 * DECISION (nie usuwaj tego komentarza):
 * Threshold = 5% because Mailgun's official policy suspends sending domains at
 * 5%+ hard bounce rate (https://help.mailgun.com/hc/en-us/articles/360011297994).
 * We trigger OPEN at exactly that threshold so circuit opens before suspension.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Window = 24h rolling: shorter window (e.g. 1h) is too noisy — a single
 * test-address CSV import could briefly spike rate then recover. 48h is too
 * slow — domain suspension can happen within hours of hitting 5%. 24h matches
 * Mailgun's own reputation calculation period.
 *
 * DECISION (nie usuwaj tego komentarza):
 * The cache is in-process. A multi-pod deployment would replace it with a shared
 * store (Redis / Neon table).
 * Fail-open on API error is intentional — an unavailable Mailgun stats endpoint
 * must NOT block legitimate transactional sends. On poll failure we KEEP the last
 * known state (so a real OPEN circuit survives a transient stats outage) and only
 * default to CLOSED when there is no prior reading. We log the error so the admin
 * sees it in /health.
 *
 * DECISION (nie usuwaj tego komentarza):
 * The cache refresh is NOT awaited on the email send path — `sendLifecycleEmail`
 * calls `triggerBounceRateRefresh()` (fire-and-forget) and reads cached state
 * synchronously. Awaiting the poll could add seconds of latency to user-facing
 * transactional sends (24h-window bounce rate doesn't move in seconds, so deciding
 * on the previous reading is safe). Mailgun queries run via `Promise.all` (3 query
 * types concurrent; pagination within each stays sequential — cursor-based), so a
 * background refresh is bounded to one query type's pagination (~6s), not ~18s.
 */

import { ENV_VARS } from '@app/environment/environment.config';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { TIME } from '@kernel/application/constants.config';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { resolveSystemActorId_IO } from '@app/event-log/system-actor';
import type { EmailCategory } from '@kernel/domain/email/email-schedule.config';
import type {
  EmailCircuitState,
  EmailDeliverabilityInfo,
} from '@kernel/models/admin/admin.dto';
import { getMailgunDailyLimitInfo } from './mailgun-daily-limit.breaker';

// ── Thresholds ────────────────────────────────────────────────────────────────

/** Bounce rate (%) at which circuit enters WARNING state. */
const BOUNCE_RATE_WARNING_PCT = 3;

/** Bounce rate (%) at which circuit enters OPEN state (matches Mailgun suspension limit). */
const BOUNCE_RATE_OPEN_PCT = 5;

/**
 * Minimum sends in the 24h window before the bounce rate is trusted to move the
 * circuit off CLOSED.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Below this floor the ratio is statistical noise — 1 hard bounce out of 1 send
 * = 100% would trip OPEN and block ALL non-critical sends on a false signal.
 * Resend is now the PRIMARY transport and Mailgun (whose Events API feeds this
 * breaker) is a low-volume fallback, so tiny samples are the norm, not the
 * exception; without a floor the breaker would sit falsely OPEN on Mailgun's
 * handful of daily sends. 20 is a pragmatic small-sample threshold: high enough
 * that a single bounce (5%) needs a real cluster to trip, low enough to still
 * react within a day of genuine volume.
 */
const BOUNCE_RATE_MIN_SAMPLE = 20;

/** Cache TTL: re-poll Mailgun every 60 minutes. */
const CACHE_TTL_MS = TIME.MS_PER_HOUR;

/** Mailgun Events API request timeout: 2s. Must be short — called in email send path. */
const MAILGUN_API_TIMEOUT_MS = 2_000;

/** How far back to look for bounce events (24h rolling window). */
const WINDOW_HOURS = 24;

// ── Critical categories — always pass circuit breaker regardless of state ─────

/**
 * Email categories that bypass OPEN circuit state.
 * These are high-urgency user-initiated sends where blocking would cause
 * direct customer harm (locked out, failed payment unacknowledged).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Scope = TRANSACTIONAL only. TRANSACTIONAL covers password reset flows
 * (magic-link plugin), payment failure, upgrade/downgrade confirmations,
 * and dunning. TRIAL_SEQUENCE and MARKETING are non-critical and can be
 * paused during a bounce incident without customer harm.
 * Review this list if new EmailCategory values are added.
 */
const CRITICAL_CATEGORIES: readonly EmailCategory[] = [
  'TRANSACTIONAL',
] as const;

// ── In-memory cache state ─────────────────────────────────────────────────────

type BounceRateCache = {
  state: EmailCircuitState;
  bounce_rate_pct: number;
  total_sent: number;
  hard_bounces: number;
  polled_at: Date;
  message: string;
};

let _cache: BounceRateCache | null = null;

/**
 * In-flight refresh promise. Concurrent sends share one refresh instead of
 * each firing its own Mailgun poll (which would multiply API load and latency).
 */
let _refreshInFlight: Promise<void> | null = null;

/**
 * Timestamp of the last completed refresh ATTEMPT (success or failure).
 * Distinct from `_cache.polled_at` (last successful reading) so a failing
 * Mailgun API does not keep retrying on every single send, yet a stale-but-
 * good cache is preserved rather than clobbered to CLOSED. Throttles retries
 * to the cache TTL even while the API is down.
 */
let _lastAttemptAt = 0;

/** Guard: only log the OPEN event once per state transition (not on every blocked send). */
let _openEventRecorded = false;
let _warningEventRecorded = false;

/**
 * Guard: emit the transport-layer blocked-send audit + report at most ONCE per
 * OPEN episode (not on every suppressed send). Re-armed when the circuit next
 * reads CLOSED — see logStateTransition. Mirrors _openEventRecorded (transition)
 * and _tripLogged in mailgun-daily-limit.breaker.
 */
let _suppressedSendLogged = false;

// ── Mailgun Events API ────────────────────────────────────────────────────────

type MailgunEventsResponse = {
  items?: Array<{
    event?: string;
    severity?: string;
  }>;
  paging?: {
    next?: string;
  };
};

/**
 * Fetch and paginate Mailgun events for the last 24h.
 * Returns { totalSent, hardBounces } — does NOT throw; errors return null.
 *
 * Mailgun events API: GET /v3/{domain}/events?event=failed&severity=permanent&begin={iso}
 * We query 'failed' + severity=permanent for hard bounces.
 * For total_sent we query 'delivered' + 'failed' combined.
 *
 * Note: 'accepted' = accepted by Mailgun, 'delivered' = accepted by recipient MTA.
 * Hard bounce = failed + severity=permanent.
 */
type MailgunStatsResult =
  | { ok: true; totalSent: number; hardBounces: number }
  | {
      ok: false;
      /** `not-configured` = brak kluczy (stan oczekiwany na deployu bez Mailguna). */
      reason: 'not-configured' | 'api-failure';
      /** Konkretny powód ostatniej nieudanej odpowiedzi, jeśli znany. */
      detail: string | null;
    };

const fetchMailgunBounceStats = async (): Promise<MailgunStatsResult> => {
  const apiKey = ENV_VARS.MAILGUN_API_KEY;
  const apiBase = ENV_VARS.MAILGUN_API_BASE_URL;
  const domain = ENV_VARS.MAILGUN_DOMAIN;

  if (!apiKey || !apiBase || !domain) {
    return { ok: false, reason: 'not-configured', detail: null };
  }

  // DECISION (nie usuwaj tego komentarza):
  // Powód porażki pollu jest PROPAGOWANY do loga. Wcześniej `fetchPage` łykał
  // każdy błąd (`catch { return null }`) i warn `EMAIL_CIRCUIT_BREAKER_POLL_FAILED`
  // trafiał do log-store z `payload: {}` — bez informacji, czy to 401, 429, timeout,
  // czy brak konfiguracji. Produkcyjny wpis z 2026-08-18 był dokładnie taki: alert
  // bez treści, nie do zdiagnozowania bez ręcznego odpytania Mailguna.
  let failureDetail: string | null = null;

  const windowStart = new Date(Date.now() - WINDOW_HOURS * TIME.MS_PER_HOUR);

  // DECISION (nie usuwaj tego komentarza):
  // `begin` MUSI być sekundami od epoki (albo czasem rfc-2822). ISO-8601 z
  // `toISOString()` Mailgun odrzuca dosłownym błędem:
  // `Invalid parameter: begin=['...'], Has to be either rfc-2822 time or seconds from epoch`
  // → HTTP 400 → `fetchMailgunBounceStats` zwracał `api-failure`, breaker szedł
  // fail-open i strażnik bounce-rate był ŚLEPY (potwierdzone empirycznie na
  // api.eu.mailgun.net 2026-08-31: ISO → 400, epoch-seconds i rfc-2822 → 200).
  // Sekundy od epoki, NIE `toISOString()` i NIE `toUTCString()` (ten drugi jest
  // rfc-1123, nie rfc-2822 — akceptowany bywa niejawnie, epoch jest jednoznaczny).
  const beginParam = String(Math.floor(windowStart.getTime() / 1000));

  const authHeader = 'Basic ' + Buffer.from(`api:${apiKey}`).toString('base64');

  /**
   * Paginate through Mailgun events (max 300 per page).
   * We limit to 3 pages (900 events) to bound latency — if sending > 900
   * emails/24h, the sample is still representative for bounce rate calculation.
   */
  const fetchPage = async (
    url: string
  ): Promise<MailgunEventsResponse | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MAILGUN_API_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: authHeader,
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        failureDetail = `HTTP ${res.status} ${res.statusText}`.trim();
        return null;
      }
      return res.json() as Promise<MailgunEventsResponse>;
    } catch (error) {
      failureDetail =
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : 'unknown fetch failure';
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  /**
   * Count events for one query type, following Mailgun's cursor pagination
   * (max 3 pages = 900 events). Pages within a query MUST be sequential —
   * each page's `paging.next` cursor is required to fetch the following page.
   * Returns null if the first page fails (so we can't trust the count);
   * a mid-pagination failure returns the partial count gathered so far.
   */
  const countEvents = async (firstUrl: string): Promise<number | null> => {
    let count = 0;
    let nextUrl: string | undefined = firstUrl;
    let page = 0;
    while (nextUrl && page < 3) {
      const data = await fetchPage(nextUrl);
      if (!data) {
        // First page failed → no trustworthy data. Later page failed → keep partial.
        return page === 0 ? null : count;
      }
      count += (data.items ?? []).length;
      nextUrl = data.paging?.next;
      page++;
    }
    return count;
  };

  const baseUrl = `${apiBase}/v3/${domain}/events`;
  const hardBounceUrl = `${baseUrl}?event=failed&severity=permanent&begin=${encodeURIComponent(beginParam)}&limit=300`;
  const deliveredUrl = `${baseUrl}?event=delivered&begin=${encodeURIComponent(beginParam)}&limit=300`;
  const failedUrl = `${baseUrl}?event=failed&begin=${encodeURIComponent(beginParam)}&limit=300`;

  // The 3 query types are independent → fetch them concurrently. Within each
  // type pagination is still sequential (cursor-based), so worst-case latency
  // is one query type's full pagination (3 pages × 2s = 6s), not the sum of
  // all three (was 9 sequential page-rounds ≈ 18s).
  const [hardBounces, totalDelivered, totalFailed] = await Promise.all([
    countEvents(hardBounceUrl),
    countEvents(deliveredUrl),
    countEvents(failedUrl),
  ]);

  // If any query's first page failed, we don't have a trustworthy sample —
  // signal failure so the caller keeps the previous cache (fail-open).
  if (hardBounces === null || totalDelivered === null || totalFailed === null) {
    return { ok: false, reason: 'api-failure', detail: failureDetail };
  }

  const totalSent = totalDelivered + totalFailed;

  return { ok: true, totalSent, hardBounces };
};

// ── State calculation ─────────────────────────────────────────────────────────

const calculateState = (
  bounce_rate_pct: number
): { state: EmailCircuitState; message: string } => {
  if (bounce_rate_pct >= BOUNCE_RATE_OPEN_PCT) {
    return {
      state: 'OPEN',
      message: `Bounce rate ${bounce_rate_pct.toFixed(1)}% ≥ ${BOUNCE_RATE_OPEN_PCT}% — domain suspension risk. Non-critical sends blocked.`,
    };
  }
  if (bounce_rate_pct >= BOUNCE_RATE_WARNING_PCT) {
    return {
      state: 'WARNING',
      message: `Bounce rate ${bounce_rate_pct.toFixed(1)}% ≥ ${BOUNCE_RATE_WARNING_PCT}% — approaching Mailgun limit. Investigate bounce sources.`,
    };
  }
  return {
    state: 'CLOSED',
    message: `Bounce rate ${bounce_rate_pct.toFixed(1)}% — within safe range.`,
  };
};

// ── Side effects: event log + alerts ─────────────────────────────────────────

const logStateTransition = (
  state: EmailCircuitState,
  bounce_rate_pct: number
): void => {
  if (state === 'OPEN' && !_openEventRecorded) {
    _openEventRecorded = true;
    _warningEventRecorded = true; // warning was also crossed
    // Fire-and-forget: audit log is best-effort here (tracking, not critical).
    // logStateTransition stays synchronous; resolve the system actor id inside
    // the void chain so the event_log write is attributed (and not silently
    // dropped by the missing-actor guard) without changing this fn's signature.
    void resolveSystemActorId_IO()
      .then(systemActorId =>
        recordAuditEvent_IO({
          eventName: APP_EVENTS.INFO.EMAIL.EMAIL_CIRCUIT_BREAKER_OPEN,
          user: systemActorId ? { id: systemActorId } : null,
          responseBody: {
            bounce_rate_pct,
            threshold_pct: BOUNCE_RATE_OPEN_PCT,
            window_hours: WINDOW_HOURS,
          },
        })
      )
      .catch(() => {
        /* best-effort */
      });
    reportIssueBackend({
      namespace: 'EMAIL_CIRCUIT_BREAKER_OPEN',
      message: `Email circuit breaker OPEN — bounce rate ${bounce_rate_pct.toFixed(1)}%. Non-critical emails blocked.`,
      payload: { bounce_rate_pct, threshold_pct: BOUNCE_RATE_OPEN_PCT },
      mode: 'error',
    });
  } else if (state === 'WARNING' && !_warningEventRecorded) {
    _warningEventRecorded = true;
    void resolveSystemActorId_IO()
      .then(systemActorId =>
        recordAuditEvent_IO({
          eventName: APP_EVENTS.INFO.EMAIL.EMAIL_CIRCUIT_BREAKER_WARNING,
          user: systemActorId ? { id: systemActorId } : null,
          responseBody: {
            bounce_rate_pct,
            threshold_pct: BOUNCE_RATE_WARNING_PCT,
            window_hours: WINDOW_HOURS,
          },
        })
      )
      .catch(() => {
        /* best-effort */
      });
    reportIssueBackend({
      namespace: 'EMAIL_CIRCUIT_BREAKER_WARNING',
      message: `Email circuit breaker WARNING — bounce rate ${bounce_rate_pct.toFixed(1)}%. Admin action recommended.`,
      payload: { bounce_rate_pct, threshold_pct: BOUNCE_RATE_WARNING_PCT },
      mode: 'warn',
    });
  } else if (state === 'CLOSED') {
    // Reset transition guards when circuit closes (episode ended). This also
    // re-arms the transport-layer suppressed-send log for the next OPEN episode.
    _openEventRecorded = false;
    _warningEventRecorded = false;
    _suppressedSendLogged = false;
  }
};

// ── Public API ────────────────────────────────────────────────────────────────

/** True if a refresh attempt is due (no cache, or both cache + last attempt are stale). */
const isRefreshDue = (now: number): boolean => {
  const cacheStale =
    !_cache || now - _cache.polled_at.getTime() >= CACHE_TTL_MS;
  const attemptStale = now - _lastAttemptAt >= CACHE_TTL_MS;
  return cacheStale && attemptStale;
};

const doRefresh = async (): Promise<void> => {
  _lastAttemptAt = Date.now();
  const stats = await fetchMailgunBounceStats();

  if (!stats.ok) {
    // Mailgun not configured / API down / timed out. FAIL-OPEN: do NOT clobber
    // a known-good cache (a real OPEN circuit must survive a transient stats
    // outage). With no prior cache, leave it null — getEmailCircuitState()
    // then returns CLOSED (safe), and the retry is throttled by _lastAttemptAt.
    //
    // Brak konfiguracji NIE jest awarią: Mailgun to fallback (Resend jest główny),
    // więc deploy bez jego kluczy to stan poprawny — logujemy go jako `info`, żeby
    // kanał `warn` niósł wyłącznie realne awarie API.
    const notConfigured = stats.reason === 'not-configured';
    const stateSuffix = _cache
      ? 'keeping last known circuit state'
      : 'circuit defaults to CLOSED';
    reportIssueBackend({
      namespace: 'EMAIL_CIRCUIT_BREAKER_POLL_FAILED',
      message: notConfigured
        ? `Mailgun bounce stats not configured (MAILGUN_API_KEY / MAILGUN_API_BASE_URL / MAILGUN_DOMAIN) — ${stateSuffix}.`
        : `Mailgun bounce stats poll failed (${stats.detail ?? 'no detail'}) — ${stateSuffix}.`,
      payload: { reason: stats.reason, detail: stats.detail },
      mode: notConfigured ? 'info' : 'warn',
    });
    return;
  }

  const { totalSent, hardBounces } = stats;

  const bounce_rate_pct = totalSent > 0 ? (hardBounces / totalSent) * 100 : 0;

  // Min-sample floor: below BOUNCE_RATE_MIN_SAMPLE the ratio is untrustworthy, so
  // force CLOSED regardless of the value (never call calculateState — a low-sample
  // 100% must NOT trip OPEN). logStateTransition('CLOSED', …) also re-arms the
  // transition guards, matching the normal CLOSED path.
  if (totalSent < BOUNCE_RATE_MIN_SAMPLE) {
    logStateTransition('CLOSED', bounce_rate_pct);
    _cache = {
      state: 'CLOSED',
      bounce_rate_pct,
      total_sent: totalSent,
      hard_bounces: hardBounces,
      polled_at: new Date(),
      message: `Insufficient sample (${totalSent} sends in ${WINDOW_HOURS}h, need ≥ ${BOUNCE_RATE_MIN_SAMPLE}) — circuit forced CLOSED.`,
    };
    return;
  }

  const { state, message } = calculateState(bounce_rate_pct);

  logStateTransition(state, bounce_rate_pct);

  _cache = {
    state,
    bounce_rate_pct,
    total_sent: totalSent,
    hard_bounces: hardBounces,
    polled_at: new Date(),
    message,
  };
};

/**
 * Refresh bounce rate from Mailgun Events API if cache is stale (> 1h).
 *
 * AWAITABLE variant — completes the poll before resolving. Concurrent callers
 * share a single in-flight poll (no thundering herd). Intended for a future
 * cron/sweep that wants to await the refresh; it currently has no runtime
 * caller. The send path uses the non-blocking `triggerBounceRateRefresh()` so
 * it never inherits poll latency, and the health endpoint reads the cached
 * state via `getEmailDeliverabilityInfo()` (same cache, refreshed on the send
 * path). Kept as the awaitable public API for that future sweep — do not delete.
 *
 * GRACEFUL FALLBACK: if Mailgun API is down or times out, the last known
 * circuit state is preserved (or CLOSED if never polled). API downtime never
 * blocks sends, and never silently resets a real OPEN circuit to CLOSED.
 */
export const refreshBounceRateCache = async (): Promise<void> => {
  if (!isRefreshDue(Date.now())) {
    return;
  }

  // Coalesce concurrent refreshes into one shared poll.
  if (!_refreshInFlight) {
    _refreshInFlight = doRefresh().finally(() => {
      _refreshInFlight = null;
    });
  }

  await _refreshInFlight;
};

/**
 * Fire-and-forget cache refresh for the EMAIL SEND PATH.
 *
 * DECISION (nie usuwaj tego komentarza):
 * The send path must read circuit state WITHOUT inheriting Mailgun poll
 * latency. Awaiting the poll added up to ~6s (was ~18s) to user-facing
 * transactional sends (contact form, account-delete-self, support) that 500
 * on email failure — risking serverless-timeout. We therefore trigger the
 * refresh non-blocking and read the cached state synchronously. Trade-off:
 * the send that triggers a stale-cache refresh decides on the PREVIOUS
 * reading; the new reading lands ~ms later for subsequent sends. This is
 * safe — bounce rate moves over hours (24h window), not seconds, and the
 * send-driven cadence (one poll per TTL) is preserved. Cold cache → CLOSED
 * (fail-open): a brand-new instance accepts the send rather than blocking on
 * a poll. Errors are swallowed (doRefresh never throws by design).
 */
export const triggerBounceRateRefresh = (): void => {
  if (!isRefreshDue(Date.now())) {
    return;
  }
  if (!_refreshInFlight) {
    _refreshInFlight = doRefresh().finally(() => {
      _refreshInFlight = null;
    });
  }
  // Intentionally not awaited. doRefresh() is non-throwing; guard anyway.
  void _refreshInFlight.catch(() => {
    /* non-blocking best-effort */
  });
};

/**
 * Return current circuit breaker state.
 * Reads from in-memory cache — does NOT hit Mailgun API.
 * Defaults to CLOSED if cache is empty (before first poll).
 */
export const getEmailCircuitState = (): EmailCircuitState => {
  return _cache?.state ?? 'CLOSED';
};

/**
 * Check whether an email of a given category can be sent.
 *
 * - CLOSED: all sends allowed
 * - WARNING: all sends allowed (admin alerted separately)
 * - OPEN: only CRITICAL_CATEGORIES are allowed
 *
 * @param category - EmailCategory from the email being sent
 * @returns true if the email may proceed, false if it must be suppressed
 */
export const canSendEmail = (category: EmailCategory): boolean => {
  const state = getEmailCircuitState();
  if (state === 'OPEN') {
    return (CRITICAL_CATEGORIES as readonly string[]).includes(category);
  }
  return true;
};

/**
 * True at most ONCE per OPEN episode — gate for the transport layer's durable
 * blocked-send audit row + warn report. Without this, a sweep of N suppressed
 * non-critical emails writes N audit rows + N reports; with it, exactly 1 per
 * OPEN episode (same once-per-incident discipline as the OPEN transition and the
 * daily-limit trip log). Re-armed when the circuit next reads CLOSED
 * (logStateTransition). The email is still suppressed on every call — only the
 * logging is deduped, never the gating decision.
 */
export const shouldLogSuppressedSend = (): boolean => {
  if (_suppressedSendLogged) {
    return false;
  }
  _suppressedSendLogged = true;
  return true;
};

/**
 * Return deliverability snapshot for admin /health endpoint.
 * Does NOT expose individual email addresses — only aggregate stats.
 */
export const getEmailDeliverabilityInfo = (): EmailDeliverabilityInfo => {
  if (!_cache) {
    return {
      bounce_rate_pct: null,
      circuit_state: 'CLOSED',
      last_check_at: null,
      message: 'No data yet — first poll pending.',
      daily_limit: getMailgunDailyLimitInfo(),
    };
  }

  return {
    bounce_rate_pct: Number(_cache.bounce_rate_pct.toFixed(2)),
    circuit_state: _cache.state,
    last_check_at: _cache.polled_at.toISOString(),
    message: _cache.message,
    daily_limit: getMailgunDailyLimitInfo(),
  };
};
