/**
 * Application routes that must not be forced into a JSON command/query contract.
 * Each entry names the file under `web-1/src/pages/api`, the verbs, who may call it, and why a
 * zod JSON contract would change the protocol. Adding a raw handler without an entry fails
 * `raw-protocols.test.ts`.
 */
export type RawProtocol = {
  readonly id: string;
  /** Path relative to `web-1/src/pages/api`, including the file name. */
  readonly file: string;
  readonly methods: readonly string[];
  /** Who may call it, in the same sense as a contract's access plus the real gate. */
  readonly access: string;
  readonly reason: string;
};

export const RAW_PROTOCOLS: readonly RawProtocol[] = [
  {
    id: 'INTERNAL_HEALTH_PUBLIC',
    file: 'v1/internal/health-public/index.ts',
    methods: ['GET', 'HEAD'],
    access: 'public probe, no session; withPublicHandler, CORS off',
    reason:
      'Liveness probe. withPublicHandler, not a CQRS JSON envelope. A contract 400 would break the probe.',
  },
  {
    id: 'INTERNAL_SWEEP_TICK',
    file: 'v1/internal/sweep-tick/index.ts',
    methods: ['GET', 'HEAD'],
    access: 'external monitor tick, no user session; withPublicHandler',
    reason:
      'Better Stack tick that runs the mail sweep. Not a client JSON operation.',
  },
  {
    id: 'INTERNAL_TRACK_CRAWLER',
    file: 'v1/internal/track-crawler/index.ts',
    methods: ['POST'],
    access:
      'server-to-server; timing-safe secret via withRawSecretHandler; 404 on a bad secret',
    reason:
      'Internal crawler ingest. The secret gate and the 404 mask are the protocol, not a user DTO.',
  },
  {
    id: 'DEV_LOGIN',
    file: 'auth/dev-login/index.ts',
    methods: ['POST'],
    access:
      'dev only; withRawSecretHandler; not a production user session flow',
    reason:
      'Secret-gated developer login that stamps a token. It is not the JSON CQRS user API.',
  },
  {
    id: 'AUTH_EXCHANGE_CODE',
    file: 'auth/exchange-code/index.ts',
    methods: ['POST'],
    access:
      'public; one-time auth code in the query; token returned in a response header',
    reason:
      'Better Auth exchange. The token travels in a header, not in a JSON data envelope.',
  },
  {
    id: 'AUTH_NATIVE_OAUTH_START',
    file: 'auth/native-oauth-start/[provider].ts',
    methods: ['GET'],
    access:
      'public redirect; provider is a path segment; kill-switch degrades to the front login',
    reason:
      'OAuth start is a redirect, not a JSON body. A contract response schema cannot describe it.',
  },
  {
    id: 'HEALTH_CHECK',
    file: 'health-check/index.ts',
    methods: ['GET', 'HEAD', 'OPTIONS'],
    access:
      'public process probe, outside /api/v1; withPublicHandler, no CORS, no rate limit',
    reason: 'Process health check outside the versioned JSON API.',
  },
  {
    id: 'WEBHOOK_STRIPE',
    file: 'v1/webhooks/stripe/index.ts',
    methods: ['POST'],
    access:
      'Stripe signature over the raw body; no session; CORS and rate limit off',
    reason:
      'Stripe webhook. The body must stay raw for the signature. A JSON parser would break verification.',
  },
  {
    id: 'WEBHOOK_RESEND',
    file: 'v1/webhooks/resend/index.ts',
    methods: ['POST'],
    access: 'provider webhook via lifecycleWebhookHandler; no user session',
    reason:
      'Resend delivery webhook. Provider payload and signature, not an application DTO.',
  },
  {
    id: 'WEBHOOK_MAILGUN',
    file: 'v1/webhooks/mailgun/index.ts',
    methods: ['POST'],
    access: 'provider webhook via lifecycleWebhookHandler; no user session',
    reason: 'Mailgun delivery webhook. Same raw provider protocol as Resend.',
  },
  {
    id: 'NEWSLETTER_CONFIRM',
    file: 'v1/public/newsletter-confirm/[token].ts',
    methods: ['GET'],
    access:
      'public; the token in the path is the gate; logged-out readers included (BASE permission)',
    reason:
      'Confirm link returns HTML. A bad token must stay on that page, not become a JSON 400 (decision C2).',
  },
  {
    id: 'NEWSLETTER_UNSUBSCRIBE',
    file: 'v1/public/newsletter-unsubscribe/index.ts',
    methods: ['GET', 'POST'],
    access: 'public; permissive token handling; BASE permission',
    reason:
      'Unsubscribe link returns HTML. A bad token must stay on that page, not become a JSON 400 (decision C2).',
  },
  {
    id: 'EMAIL_UNSUBSCRIBE',
    file: 'v1/email/unsubscribe/index.ts',
    methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
    access:
      'public; GET/HEAD 302 to the branded page with no side effect; POST is the mutation; OPTIONS is CORS',
    reason:
      'One file mixes a side-effect-free redirect with a JSON POST. A single JSON contract would turn the human click into a 400.',
  },
];
