/**
 * Declarative environment schema for web-1 (BDX W1.2).
 *
 * SSOT for *which* env vars exist, *whether* they are required, and *what shape*
 * they must take. This layer is the SINGLE gatekeeper for web-1 env validation —
 * it REPLACES the kernel `validateEnv(RAW_VARS, 'web-1')` call (which treated
 * every entry as unconditionally required and therefore hard-failed prod on
 * legitimately-optional integrations like Apple / Cloudinary / Stripe).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Why a schema layer instead of kernel `validateEnv`:
 *   - kernel `validateEnv` (READONLY) flags EVERY empty/undefined entry as
 *     "missing" → in PRODUCTION it calls process.exit(1). With the full RAW_VARS
 *     registry that means a prod deploy WITHOUT Apple sign-in / Cloudinary /
 *     Stripe configured would crash on boot, even though those are feature-flagged
 *     by presence. The schema distinguishes required('always'|'prod') from
 *     optional, so only genuinely-required vars gate boot.
 *   - kernel `validateEnv` stays the gatekeeper for `main/` (untouched).
 *
 * Behavior contract (MUST be preserved — Vitest integration tests depend on it):
 *   - DEVELOPMENT only (or process.env.NODE_ENV === 'development'): SOFT mode
 *     (isSoftMode; STAGING and PREVIEW are hard fail-fast like PRODUCTION).
 *     Missing required vars → console.warn ONCE, NEVER throw / exit. The Vitest
 *     suite runs with NODE_ENV_MANUAL=DEVELOPMENT and a partial fake env; this
 *     branch keeps module-load import of handlers non-throwing.
 *   - PRODUCTION: loud fail-fast. Missing required-secret → process.exit(1)
 *     (server context) or throw (browser context — web-1 is server-only, kept for
 *     symmetry with kernel behavior).
 *   - format validation runs ONLY when a value is present (never forces a value
 *     to exist — that is the job of `required`). A present-but-malformed value is
 *     a violation in every mode (loud warn in soft, fail-fast in prod).
 *
 * `next build` is untouched: validation runs on module-load (instrumentation /
 * runtime import of environment.config), never inside the bundler.
 */

import * as FsModule from 'node:fs';

export type EnvRequirement = 'always' | 'prod' | 'optional';

export type EnvFormat = 'url' | 'int' | 'enum' | 'string' | 'bool' | 'secret';

export interface EnvVarSpec {
  /** Env var name (matches the RAW_VARS key + process.env key). */
  name: string;
  /**
   * - 'always'   → required in EVERY mode (dev soft-warns, prod fail-fast).
   * - 'prod'     → required only when running as PRODUCTION.
   * - 'optional' → never required (feature-flagged by presence).
   */
  required: EnvRequirement;
  /** Shape validated ONLY when the value is present. */
  format: EnvFormat;
  /** Allowed values for format 'enum' (compared case-sensitively after upper-casing where relevant). */
  enum?: readonly string[];
  /**
   * Conditional requirement: when set, the var is required (in the modes implied
   * by `required`) ONLY if the predicate over the resolved env map is true.
   * Used for DATABASE_APP_LOGS_URL (required in prod only when ENABLE_APP_LOGS_DB).
   */
  requiredWhen?: (env: Record<string, string | boolean | undefined>) => boolean;
}

/**
 * web-1 environment schema. Order mirrors environment.config.ts RAW_VARS for
 * easy diffing.
 *
 * NOTE on `required`:
 *   - 'always' — core invariants the app cannot run without in any non-dev mode.
 *     In soft (dev) mode these only warn, so local dev with a partial .env still
 *     boots. The set is intentionally small (DB + auth secret + base URLs +
 *     NODE_ENV_MANUAL).
 *   - 'prod'   — required for a real production deploy (mail delivery, admin
 *     allow-list, internal S2S secret) but tolerated absent in dev/staging.
 *   - 'optional' — feature-flagged by presence (OAuth providers, Cloudinary,
 *     Stripe, native deep-link, tuning knobs). NEVER gate boot.
 */
export const ENV_SCHEMA: readonly EnvVarSpec[] = [
  // ── Core public surface ──────────────────────────────────────────────────
  { name: 'FRONTEND_PUBLIC_DOMAIN', required: 'always', format: 'string' },
  { name: 'FRONTEND_PUBLIC_PORT', required: 'optional', format: 'string' },
  {
    name: 'NODE_ENV_MANUAL',
    required: 'always',
    format: 'enum',
    // Walidacja per-mode (2026-06): SOFT = tylko DEVELOPMENT (isSoftMode). HARD fail-fast =
    // STAGING + PREVIEW + PRODUCTION. PROD-REQUIRED ('prod' specs) = PRODUCTION + STAGING
    // (isProductionMode - staging przejal role pre-prod, waliduje sie jak prod). PREVIEW =
    // hard, ale nie prod-required (zaparkowany 2026-06; enum zostaje na wypadek odmrozenia).
    // Wszystkie 4 MUSZA byc w enumie - pominiecie = enum format-check -> process.exit(1).
    enum: ['DEVELOPMENT', 'STAGING', 'PREVIEW', 'PRODUCTION'],
  },

  // ── Database ─────────────────────────────────────────────────────────────
  { name: 'DATABASE_URL', required: 'always', format: 'url' },
  {
    name: 'DATABASE_APP_LOGS_URL',
    required: 'prod',
    format: 'url',
    // Only required (in prod) when the app-logs DB feature is enabled.
    requiredWhen: env => env.ENABLE_APP_LOGS_DB === true,
  },
  { name: 'ENABLE_APP_LOGS_DB', required: 'optional', format: 'bool' },
  { name: 'SEO_INDEXING_ENABLED', required: 'optional', format: 'bool' },

  // ── Better Auth (auth SSOT) ──────────────────────────────────────────────
  { name: 'BETTER_AUTH_SECRET', required: 'always', format: 'secret' },
  { name: 'BETTER_AUTH_URL', required: 'always', format: 'url' },
  { name: 'PUBLIC_URL', required: 'always', format: 'url' },

  // ── Internal / signing secrets ───────────────────────────────────────────
  // Internal S2S shared secret (dev-login defense-in-depth + track-crawler auth).
  // Required in prod: track-crawler fail-closes (503) and dev-login fail-closes
  // (404) without it, so a real prod deploy must configure it.
  { name: 'INTERNAL_SHARED_SECRET', required: 'prod', format: 'secret' },
  { name: 'EMAIL_UNSUBSCRIBE_SECRET', required: 'prod', format: 'secret' },
  { name: 'IMPERSONATION_HMAC_SECRET', required: 'prod', format: 'secret' },

  // ── Admin allow-list ─────────────────────────────────────────────────────
  { name: 'MASTER_ADMIN_EMAIL', required: 'prod', format: 'string' },

  // ── Debug / tuning knobs (optional everywhere) ───────────────────────────
  { name: 'INIT_BACKEND_DEBUG_MODE', required: 'optional', format: 'bool' },
  { name: 'INIT_BACKEND_DEBUG_DB_MODE', required: 'optional', format: 'bool' },

  // ── Native deep-link cutover switch ──────────────────────────────────────
  { name: 'NATIVE_DEEPLINK_ENABLED', required: 'optional', format: 'bool' },

  // ── Trust-aware IP resolution (optional — secure-by-default unset) ────────
  { name: 'TRUSTED_EDGE', required: 'optional', format: 'string' },
  { name: 'TRUSTED_PROXY_DEPTH', required: 'optional', format: 'int' },

  // ── Runtime / process knobs ──────────────────────────────────────────────
  { name: 'PORT', required: 'optional', format: 'int' },
  { name: 'RUN_SMOKE_TESTS_ON_STARTUP', required: 'optional', format: 'bool' },

  // ── Dev email sink (quota guard — optional, INERT outside DEVELOPMENT) ─────
  // DEV_EMAIL_LIVE_BUDGET: 'int' shape only; the consumer (email-dev-sink.ts)
  // clamps to >= 0, so a negative value is treated as the safe default (1), NOT
  // "unlimited". Set 0 to stub every send (no canary).
  { name: 'DEV_EMAIL_LIVE_BUDGET', required: 'optional', format: 'int' },
  { name: 'DEV_EMAIL_FORCE_LIVE', required: 'optional', format: 'bool' },

  // ── OAuth providers (optional — Better Auth feature-flagged by presence) ──
  { name: 'GOOGLE_CLIENT_ID', required: 'optional', format: 'string' },
  { name: 'GOOGLE_CLIENT_SECRET', required: 'optional', format: 'secret' },
  {
    name: 'APPLE_APP_BUNDLE_IDENTIFIER',
    required: 'optional',
    format: 'string',
  },
  { name: 'APPLE_ID', required: 'optional', format: 'string' },
  { name: 'APPLE_TEAM_ID', required: 'optional', format: 'string' },
  { name: 'APPLE_PRIVATE_KEY', required: 'optional', format: 'secret' },
  { name: 'APPLE_KEY_ID', required: 'optional', format: 'string' },

  // ── Mailgun (transactional email) ────────────────────────────────────────
  // Required in prod: without it the app cannot send any transactional email
  // (welcome, magic-link, account, GDPR confirmations).
  { name: 'MAILGUN_API_KEY', required: 'prod', format: 'secret' },
  { name: 'MAILGUN_API_BASE_URL', required: 'prod', format: 'url' },
  { name: 'MAILGUN_DOMAIN', required: 'prod', format: 'string' },
  { name: 'FROM_EMAIL', required: 'prod', format: 'string' },
  // SMTP fallback knobs — optional (the HTTP API path is primary).
  { name: 'MAILGUN_SMTP_HOST', required: 'optional', format: 'string' },
  { name: 'MAILGUN_SMTP_PORT', required: 'optional', format: 'string' },
  { name: 'MAILGUN_SMTP_LOGIN', required: 'optional', format: 'string' },
  { name: 'MAILGUN_SMTP_PASSWORD', required: 'optional', format: 'secret' },

  // ── Resend (transactional email — primary gdy klucz obecny; Mailgun fallback) ─
  // Feature-flagged BY PRESENCE (jak Stripe/Apple/Cloudinary): RESEND_API_KEY
  // ustawiony = Resend primary, pusty = Mailgun. Zero osobnej flagi/zmiennej.
  // From = noreply@nailfolio.app (stała w adapterze — domena niezmienna dla tej apki).
  { name: 'RESEND_API_KEY', required: 'optional', format: 'secret' },

  // ── GA4 Measurement Protocol (serwerowy purchase) ────────────────────────
  // Feature-flagged BY PRESENCE (para): bez nich webhook Stripe po prostu nie
  // raportuje przychodu — fulfilment i tak jest nietknięty. Sekret z GA4 →
  // Administracja → Strumienie danych → Measurement Protocol.
  { name: 'GA4_MEASUREMENT_ID', required: 'optional', format: 'string' },
  { name: 'GA4_API_SECRET', required: 'optional', format: 'secret' },

  // ── Resend Audiences (newsletter broadcast list) ─────────────────────────
  // Feature-flagged BY PRESENCE (para): oba ustawione = potwierdzeni subskrybenci
  // synchronizowani do Resend Audience (contacts.create/update), by broadcast miał
  // listę odbiorców. PEŁNY klucz (contacts+broadcasts), ODRĘBNY od send-only
  // RESEND_API_KEY (least-privilege). Puste = newsletter działa (DB = SSOT zgody),
  // po prostu bez syncu do listy broadcastowej. Nigdy nie gate'uje boot.
  { name: 'RESEND_MARKETING_API_KEY', required: 'optional', format: 'secret' },
  { name: 'RESEND_AUDIENCE_ID', required: 'optional', format: 'string' },

  // ── Cloudinary (image vendor — optional, feature-flagged by presence) ─────
  { name: 'CLOUDINARY_SECRET', required: 'optional', format: 'secret' },
  { name: 'CLOUDINARY_CLOUD_NAME', required: 'optional', format: 'string' },
  { name: 'CLOUDINARY_API_KEY', required: 'optional', format: 'string' },

  // ── Stripe (billing — optional, feature-flagged by presence) ─────────────
  { name: 'STRIPE_SECRET_KEY', required: 'optional', format: 'secret' },
  { name: 'STRIPE_WEBHOOK_SECRET', required: 'optional', format: 'secret' },
  { name: 'STRIPE_PORTAL_RETURN_URL', required: 'optional', format: 'url' },
  {
    name: 'STRIPE_PORTAL_CONFIGURATION_ID',
    required: 'optional',
    format: 'string',
  },
  { name: 'STRIPE_TEST_COUPON_ID', required: 'optional', format: 'string' },

  // ── Cloudflare Turnstile (anti-bot na publicznym contact form) ────────────
  // Feature-flagged BY PRESENCE: sekret obecny = server-side weryfikacja tokenu
  // Turnstile WYMAGANA na POST /public/contact-form (brak/zły token → 403);
  // pusty = weryfikacja OFF (dev/staging — formularz działa bez widgetu).
  // Celowo 'optional' (nie 'prod'): mechanizm ma być włączalny/wyłączalny samą
  // obecnością env, nigdy nie gate'uje boot.
  { name: 'TURNSTILE_SECRET_KEY', required: 'optional', format: 'secret' },

  // ── PostHog Error Tracking (server-side — optional, feature-flagged by presence) ─
  // POSTHOG_PROJECT_KEY: publiczny phc_ ingestion key (NIE sekret — 'string', nie
  // 'secret'); pusty = server-side error tracking OFF (EventLog zostaje SSOT logów).
  // POSTHOG_HOST: bezpośredni EU ingest URL (default w posthog-server.ts gdy pusty).
  { name: 'POSTHOG_PROJECT_KEY', required: 'optional', format: 'string' },
  { name: 'POSTHOG_HOST', required: 'optional', format: 'url' },

  // ── Better Stack / Neon infrastructure monitoring (optional by presence) ──
  // Heartbeat URL and Neon API key are secrets. The Neon key should be organization-
  // project-scoped, never the founder personal key. Budget defaults to 100 CU-h.
  {
    name: 'BETTERSTACK_NEON_QUOTA_HEARTBEAT_URL',
    required: 'optional',
    format: 'secret',
  },
  { name: 'NEON_MONITORING_API_KEY', required: 'optional', format: 'secret' },
  {
    name: 'NEON_MONITORING_PROJECT_ID',
    required: 'optional',
    format: 'string',
  },
  {
    name: 'NEON_COMPUTE_BUDGET_CU_HOURS',
    required: 'optional',
    format: 'int',
  },
] as const;

/** Env map shape accepted by the validator (RAW_VARS is already normalized). */
type EnvMap = Record<string, string | boolean | undefined>;

const isPresent = (value: string | boolean | undefined): boolean => {
  // Booleans are ALWAYS present (`false` is a valid configured value, not "missing").
  if (typeof value === 'boolean') {
    return true;
  }
  // Strings: empty / whitespace-trimmed-to-empty (normalizeString) counts as absent.
  return typeof value === 'string' && value.length > 0;
};

// STAGING traktowane jak PRODUCTION dla WALIDACJI env (hard fail-fast + prod-required),
// by staging w pelni odzwierciedlal prod (decyzja 2026-06: preview zrezygnowane, staging
// przejmuje role pre-prod). UWAGA - granica: to dotyczy TYLKO walidacji env. Side-effecty
// kodu bramkowane przez IS_PRODUCTION_ENV (utils: dev-login, track-crawler) zostaja
// PRODUCTION-only -> staging jest izolowane (prod-STRICTNESS, nie prod-IDENTITY).
const isProductionMode = (env: EnvMap): boolean => {
  const manual =
    typeof env.NODE_ENV_MANUAL === 'string'
      ? env.NODE_ENV_MANUAL.toUpperCase()
      : '';
  return manual === 'PRODUCTION' || manual === 'STAGING';
};

const isSoftMode = (env: EnvMap): boolean => {
  const manual =
    typeof env.NODE_ENV_MANUAL === 'string'
      ? env.NODE_ENV_MANUAL.toUpperCase()
      : '';
  // STAGING USUNIETE z soft (2026-06): staging waliduje sie TWARDO jak prod (hard fail-fast),
  // nie jak dev. Soft = tylko DEVELOPMENT (+ NODE_ENV=development dla Vitest z partial env).
  return (
    manual === 'DEVELOPMENT' ||
    (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development')
  );
};

/** True when the var is required given the current mode + conditional predicate. */
const isRequired = (spec: EnvVarSpec, env: EnvMap): boolean => {
  if (spec.requiredWhen && !spec.requiredWhen(env)) {
    return false;
  }
  if (spec.required === 'always') {
    return true;
  }
  if (spec.required === 'prod') {
    return isProductionMode(env);
  }
  return false;
};

// Generic URL shape: `<scheme>://<rest>`. Intentionally NOT http(s)-only — the
// same format covers public http(s) URLs (BETTER_AUTH_URL, PUBLIC_URL, Mailgun
// base, Stripe return) AND DB connection strings (postgresql://, postgres://).
// The check only asserts "this is a URL, not a bare token / typo", never the scheme.
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\/.+/i;
const INT_RE = /^-?\d+$/;
const BOOL_RE = /^(true|false)$/i;

/**
 * Validate the *shape* of a present value. Returns an error string or null.
 * RAW_VARS already normalized booleans to JS booleans (normalizeBool) and strings
 * to trimmed strings (normalizeString), so format checks operate on that.
 */
const validateFormat = (
  spec: EnvVarSpec,
  value: string | boolean | undefined
): string | null => {
  if (!isPresent(value)) {
    return null; // presence is enforced separately by `isRequired`.
  }

  switch (spec.format) {
    case 'bool':
      // normalizeBool already yields a JS boolean; a raw string would be a misuse.
      if (typeof value !== 'boolean' && !BOOL_RE.test(String(value))) {
        return `${spec.name}: expected boolean, got "${String(value)}"`;
      }
      return null;
    case 'int':
      if (typeof value === 'boolean' || !INT_RE.test(String(value))) {
        return `${spec.name}: expected integer, got "${String(value)}"`;
      }
      return null;
    case 'url':
      if (typeof value !== 'string' || !URL_RE.test(value)) {
        return `${spec.name}: expected http(s) URL, got "${String(value)}"`;
      }
      return null;
    case 'enum':
      if (
        typeof value !== 'string' ||
        !spec.enum?.some(allowed => allowed === value.toUpperCase())
      ) {
        return `${spec.name}: expected one of [${(spec.enum ?? []).join(', ')}], got "${String(value)}"`;
      }
      return null;
    case 'secret':
    case 'string':
      // Presence already verified; no further shape constraint.
      return null;
    default:
      return null;
  }
};

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

/**
 * Suppress duplicate prints within a single process run (mirrors kernel
 * validateEnv flag-file behavior so repeated module imports don't re-spam).
 */
const printOnce = (key: string): boolean => {
  if (typeof process === 'undefined' || typeof window !== 'undefined') {
    return true;
  }
  const flagFile = `/tmp/env_schema_validated_web-1_${key}_${process.env?.PPID || process.ppid || 'unknown'}`;
  try {
    // Statyczny import node:fs (web-1 = server-only; guard `typeof window`
    // wyżej i tak odcina ewentualny kontekst kliencki) — bez require i bez
    // tłumienia lintera (ratchet legacy-code trzyma baseline 0).
    const fs = FsModule;
    try {
      const fd = fs.openSync(flagFile, 'wx');
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: unknown }).code === 'EEXIST'
      ) {
        return false;
      }
      return true;
    }
  } catch {
    return true;
  }
};

/**
 * Validate `env` against ENV_SCHEMA.
 *
 * @param env  the normalized RAW_VARS map (strings + JS booleans).
 *
 * Side effects: warns (soft mode) or fail-fasts (prod) on missing-required or
 * present-but-malformed vars. Returns nothing — the env map itself is the SSOT.
 */
export const validateEnvSchema = (env: EnvMap): void => {
  const missing: string[] = [];
  const malformed: string[] = [];

  for (const spec of ENV_SCHEMA) {
    const value = env[spec.name];

    if (isRequired(spec, env) && !isPresent(value)) {
      missing.push(spec.name);
      continue; // a missing value cannot also be format-checked.
    }

    const formatError = validateFormat(spec, value);
    if (formatError) {
      malformed.push(formatError);
    }
  }

  if (missing.length === 0 && malformed.length === 0) {
    return;
  }

  const soft = isSoftMode(env);
  const statusText = soft ? '(WARNING - SOFT MODE)' : '(CRITICAL ERROR)';

  const lines: string[] = [];
  if (missing.length > 0) {
    lines.push(`${BOLD}Missing required environment variables:${RESET}${RED}`);
    for (const key of missing) {
      lines.push(`   • ${key}`);
    }
  }
  if (malformed.length > 0) {
    lines.push(`${BOLD}Malformed environment variables:${RESET}${RED}`);
    for (const err of malformed) {
      lines.push(`   • ${err}`);
    }
  }

  const message = `
${RED}${BOLD}│
│   ${YELLOW}ENVIRONMENT SCHEMA VALIDATION ${statusText} - [WEB-1]${RED}
│
${lines.map(l => `│   ${l}`).join('\n')}
│
│   ${BOLD}Check your .env files and restart the application.${RESET}${RED}
│${RESET}
`;

  if (soft) {
    if (printOnce('soft')) {
      console.warn(message);
    }
    return;
  }

  // Hard mode (production): loud fail-fast.
  console.error(message);

  if (typeof window !== 'undefined') {
    throw new Error(
      `Critical: env schema validation failed in web-1: ${[...missing, ...malformed.map(m => m.split(':')[0])].join(', ')}`
    );
  }

  if (typeof process !== 'undefined' && typeof process.exit === 'function') {
    process.exit(1);
  }
};
