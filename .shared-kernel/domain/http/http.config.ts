export type HTTPMethod = 'post' | 'get' | 'patch' | 'delete';

export type HTTPStatus =
  200 | 201 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 409 | 429 | 500 | 503;

export const API_VER = '/api/v1/';

export const CUSTOM_HEADERS = {
  authorization: 'authorization',
  userMetadata: 'user-metadata',
  becomeUser: 'become-user',
  pathname: 'pathname',
  xRequestId: 'x-request-id',
  // Internal S2S secret header (dev-login, track-crawler) — value verified timing-safe.
  xInternalSecret: 'x-internal-secret',
  // Stripe webhook signature header — verified against STRIPE_WEBHOOK_SECRET.
  stripeSignature: 'stripe-signature',
  // Cloudflare Turnstile token on a magic-link send, required only after a risk signal
  // (web-1 login-abuse/magic-link-send-gate.ts); CORS-allowed through this list.
  turnstileToken: 'x-turnstile-token',
} as const;
