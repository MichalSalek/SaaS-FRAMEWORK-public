/**
 * Raw S2S track-crawler: a timing-safe `x-internal-secret`, own method and body
 * checks, and no permission gate. The test env is not production, so the 503
 * fail-closed branch is not taken. A bad secret is an opaque 404. A non-POST is
 * 405 ACCESS_DENIED_INFO. A refused path is 400. A tracked path is 204.
 * Paths come from kernel TRACKED_PATHS.
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

    // The method check runs after auth, so an authenticated caller gets 405.
    // The event is the APP_EVENTS constant (health-public uses the same 405).
    expect(status).toBe(405);
    expect(event).toBe(APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO);
  });

  it('returns 400 VALIDATION_FAILED for a human reading a page (not a tracked request)', async () => {
    const { status, event } = await mockApiHandler(handler, {
      method: 'POST',
      headers: { 'x-internal-secret': VALID_SECRET },
      body: {
        user_agent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
        path: '/pricing/',
      },
    });

    // The event is the APP_EVENTS constant.
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

  it('returns 400 VALIDATION_FAILED for our own monitoring probe on a machine file', async () => {
    const { status, event } = await mockApiHandler(handler, {
      method: 'POST',
      headers: { 'x-internal-secret': VALID_SECRET },
      body: {
        user_agent: 'example-monitor geo-healthcheck (+https://nailfolio.app)',
        path: '/llms.txt',
      },
    });

    expect(status).toBe(400);
    expect(event).toBe(APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED);
  });

  it('returns 204 and stores the category when ChatGPT-User reads a page', async () => {
    const created: Array<{
      data: { path: string; bot_category: string | null };
    }> = [];
    mockDb({
      aiCrawlerEvent: {
        create: async (args: {
          data: { path: string; bot_category: string | null };
        }) => {
          created.push(args);
          return { id: 'crawler_event_test' };
        },
      },
    });

    const { status } = await mockApiHandler(handler, {
      method: 'POST',
      headers: { 'x-internal-secret': VALID_SECRET },
      body: {
        user_agent:
          'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
        path: '/en/pricing/',
      },
    });

    expect(status).toBe(204);
    expect(created[0]?.data.path).toBe('/en/pricing/');
    expect(created[0]?.data.bot_category).toBe('ai-search');
  });
});
