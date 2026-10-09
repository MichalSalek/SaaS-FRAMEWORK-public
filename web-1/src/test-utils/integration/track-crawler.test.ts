/**
 * Integration-handler test — RAW S2S endpoint /api/v1/internal/track-crawler (BDX W0.3 B).
 *
 * This handler is INTENTIONALLY not a standard middleware route: it does its own raw
 * auth (shared-secret in `x-internal-secret`, compared with crypto.timingSafeEqual),
 * its own method + rate-limit + body checks, and raw `res.status().end()/.json()`
 * responses (no APP_EVENTS, no permission gate). We therefore characterize the REAL
 * raw behavior, not an envelope contract.
 *
 * TEST ENV (vitest.config.ts): INTERNAL_SHARED_SECRET = 'test-internal-shared-secret-0123456789'
 * and NODE_ENV_MANUAL = 'DEVELOPMENT' ⇒ IS_PRODUCTION_ENV() === false. So `expectedSecret`
 * is truthy and the prod fail-closed (503) branch is NOT taken here.
 *
 * REAL behavior characterized:
 *   - missing / wrong-length / wrong-value secret → OPAQUE 404 (bare `res.status(404).end()`:
 *     no JSON body, so `event` is undefined). This masks the endpoint's existence — the
 *     same opaque rejection for every pre-auth failure.
 *   - correct secret + non-POST method → 405 { event: ACCESS_DENIED_INFO } (method check is
 *     AFTER auth, so an authenticated caller gets a proper 405, not the opaque 404).
 *     BDX W6.1/F5: the response `event` is now the APP_EVENTS SSOT constant (was the raw
 *     string 'METHOD_NOT_ALLOWED') — same event health-public uses for its 405.
 *   - correct secret + POST + untracked path → 400 { event: VALIDATION_FAILED } (was the raw
 *     string 'INVALID_PAYLOAD').
 *   - correct secret + POST + valid tracked-path body → 204 (fire-and-forget DB insert OK).
 *
 * Header name (from the handler): `x-internal-secret`. Tracked paths come from the kernel
 * SSOT TRACKED_PATHS (e.g. '/robots.txt').
 */

import { describe, it, expect } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import handler from '../../pages/api/v1/internal/track-crawler/index';

const VALID_SECRET = 'test-internal-shared-secret-0123456789';

const VALID_BODY = {
  user_agent: 'GPTBot/1.0',
  path: '/robots.txt', // ∈ kernel TRACKED_PATHS
  ip_address: '203.0.113.7',
  country: 'US',
};

describe('POST /api/v1/internal/track-crawler (RAW S2S handler)', () => {
  it('returns opaque 404 (no body) when the x-internal-secret header is absent', async () => {
    const { status, event, raw } = await mockApiHandler(handler, {
      method: 'POST',
      body: VALID_BODY,
    });

    // Opaque 404 = bare .end(): masks endpoint existence; no envelope.
    expect(status).toBe(404);
    expect(event).toBeUndefined();
    expect(raw).toBeUndefined();
  });

  it('returns opaque 404 when the secret has the wrong length (length pre-check)', async () => {
    const { status, event } = await mockApiHandler(handler, {
      method: 'POST',
      body: VALID_BODY,
      headers: { 'x-internal-secret': 'too-short' },
    });

    expect(status).toBe(404);
    expect(event).toBeUndefined();
  });

  it('returns opaque 404 when the secret is wrong (same length, bad value)', async () => {
    // Same length as VALID_SECRET so timingSafeEqual runs and rejects on value.
    const wrongSameLength = 'X'.repeat(VALID_SECRET.length);
    expect(wrongSameLength.length).toBe(VALID_SECRET.length);

    const { status, event } = await mockApiHandler(handler, {
      method: 'POST',
      body: VALID_BODY,
      headers: { 'x-internal-secret': wrongSameLength },
    });

    expect(status).toBe(404);
    expect(event).toBeUndefined();
  });

  it('returns 405 ACCESS_DENIED_INFO for a correct secret on a non-POST method', async () => {
    const { status, event } = await mockApiHandler(handler, {
      method: 'GET',
      headers: { 'x-internal-secret': VALID_SECRET },
    });

    // Method check is AFTER auth → authenticated caller gets a proper 405.
    // BDX W6.1/F5: event is the APP_EVENTS SSOT constant (was raw 'METHOD_NOT_ALLOWED').
    expect(status).toBe(405);
    expect(event).toBe(APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO);
  });

  it('returns 400 VALIDATION_FAILED for a correct secret + POST with an untracked path', async () => {
    const { status, event } = await mockApiHandler(handler, {
      method: 'POST',
      headers: { 'x-internal-secret': VALID_SECRET },
      body: { user_agent: 'GPTBot/1.0', path: '/not-a-tracked-path' },
    });

    // BDX W6.1/F5: event is the APP_EVENTS SSOT constant (was raw 'INVALID_PAYLOAD').
    expect(status).toBe(400);
    expect(event).toBe(APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED);
  });

  it('returns 204 for a correct secret + POST + valid tracked-path body (insert OK)', async () => {
    mockDb({
      aiCrawlerEvent: {
        create: async () => ({ id: 'crawler_event_test' }),
      },
    });

    const { status, raw } = await mockApiHandler(handler, {
      method: 'POST',
      headers: { 'x-internal-secret': VALID_SECRET },
      body: VALID_BODY,
    });

    // 204 No Content (fire-and-forget), bare .end() ⇒ no body.
    expect(status).toBe(204);
    expect(raw).toBeUndefined();
  });
});
