export const RUNTIME_CONFIG_KEYS = {
  FREE_EMAIL_MODE: {
    default: 'OFF',
    type: 'string' as const,
    description: 'Free onboarding email delivery: OFF, PREVIEW or ON',
  },
  // DECISION: SESSION_TIMEOUT_MINUTES and MAX_LOGIN_ATTEMPTS are absent on purpose. Session lifetime
  // is Better Auth `expiresIn` (SESSION_EXPIRES_IN_SECONDS, auth.config.ts), read once at module
  // boot, so an editable knob would look live and do nothing. MAX_LOGIN_ATTEMPTS was never wired, so
  // the setting was removed.
  // DECISION: the MAX_GALLERY_RECORDS knob was removed from this set on purpose: the gallery cap is
  // a pricing fact, not an operational knob (see
  // web-1/src/domain/gallery/operations/gallery-create.operation.ts). The de-seed reconcile prunes
  // the old row and consumers fall back to the plan limit.
  MAINTENANCE_MESSAGE: {
    // DECISION: read publicly (no-auth) via getPublicRuntimeConfig_IO -> MaintenanceBanner (global,
    // non-dismissable); empty string hides it. The public projection is a narrow allow-list
    // (maintenanceMessage, maintenanceMode, verboseLogMode); the rest of the table is admin-internal.
    default: '',
    type: 'string' as const,
    description: 'Banner shown to all users (empty = hidden)',
  },
  MAINTENANCE_MODE: {
    // DECISION: also read publicly (no-auth), next to MAINTENANCE_MESSAGE. MESSAGE
    // is an info bar over a working app, MODE is a hard closure (front redirects to /maintenance);
    // separate so an admin can announce a break without starting it. The front guard lets admins and
    // the login path through (useMaintenanceGate) so the mode can be switched off from inside, and the
    // backend is NOT gated, otherwise nothing could flip the knob back.
    default: 'false',
    type: 'boolean' as const,
    description: 'Redirect all non-admin traffic to the maintenance page',
  },
  PAIRING_SESSION_TTL_MINUTES: {
    // DECISION: the unit is MINUTES, default '15', matching PAIRING_CONFIG.TOKEN_TTL_MINUTES. The QR
    // pairing token is deliberately short-lived; an hours-based knob wired as minutes would have been
    // a 96x security regression. The numeric constraint caps it at 60.
    default: '15',
    type: 'number' as const,
    description:
      'Pairing token time-to-live in MINUTES (short-lived for security)',
  },
  VERBOSE_LOG_MODE: {
    default: 'false',
    type: 'boolean' as const,
    description: 'Enable verbose (info) logging to Event Log Store',
  },
  EVENT_LOG_MAX_AGE_DAYS: {
    default: '90',
    type: 'number' as const,
    description:
      'Max age of event log records (days). Older records are deleted.',
  },
  EVENT_LOG_MAX_RECORDS: {
    default: '50000',
    type: 'number' as const,
    description:
      'Max number of event log records. Oldest are deleted when exceeded.',
  },
  STRIPE_EVENT_JANITOR_STALE_MINUTES: {
    default: '5',
    type: 'number' as const,
    description:
      'Minutes a Stripe webhook event may remain processed=false before janitor retries it.',
  },
  STRIPE_EVENT_JANITOR_MAX_RETRIES: {
    default: '5',
    type: 'number' as const,
    description:
      'Max retry attempts by janitor before a Stripe webhook event is dead-lettered.',
  },
  STRIPE_EVENT_JANITOR_BATCH_SIZE: {
    default: '10',
    type: 'number' as const,
    description:
      'Max number of unprocessed Stripe events the janitor processes per sweep.',
  },
  API_TIMING_DEBUG_MODE: {
    default: 'false',
    type: 'boolean' as const,
    description:
      'Enable API timing debug logging (prod: runtime toggle; staging: always on).',
  },
} as const;

export type RuntimeConfigKey = keyof typeof RUNTIME_CONFIG_KEYS;
export type RuntimeConfigValueType = 'string' | 'number' | 'boolean' | 'json';
