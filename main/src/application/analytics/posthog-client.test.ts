import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PostHog } from 'posthog-js';
import {
  attachPosthog,
  capturePosthog,
  getPosthog,
  resetPosthogClientForTests,
  withPosthog,
} from './posthog-client';

const fakePosthog = (): {
  client: PostHog;
  capture: ReturnType<typeof vi.fn>;
} => {
  const capture = vi.fn();
  return { client: { capture } as unknown as PostHog, capture };
};

describe('posthog-client', () => {
  afterEach(() => {
    resetPosthogClientForTests();
    vi.useRealTimers();
    window.history.replaceState(null, '', '/');
  });

  it('keeps captures made before init and sends them in order with their time and page', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T10:00:00.000Z'));
    window.history.replaceState(null, '', '/pricing/');
    capturePosthog('pricing_page_viewed');
    vi.setSystemTime(new Date('2026-10-18T10:00:02.000Z'));
    // An in-app navigation before init: each event keeps its own page.
    window.history.replaceState(null, '', '/user/login/');
    capturePosthog('cta_click', { location: 'pricing-tier' });

    const { client, capture } = fakePosthog();
    vi.setSystemTime(new Date('2026-10-18T10:00:05.000Z'));
    attachPosthog(client);

    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls[0]).toEqual([
      'pricing_page_viewed',
      {
        $current_url: 'http://localhost:3000/pricing/',
        $pathname: '/pricing/',
      },
      { timestamp: new Date('2026-10-18T10:00:00.000Z') },
    ]);
    expect(capture.mock.calls[1]).toEqual([
      'cta_click',
      {
        $current_url: 'http://localhost:3000/user/login/',
        $pathname: '/user/login/',
        location: 'pricing-tier',
      },
      { timestamp: new Date('2026-10-18T10:00:02.000Z') },
    ]);
  });

  it('captures at once, without a backdated time, once PostHog is ready', () => {
    const { client, capture } = fakePosthog();
    attachPosthog(client);
    capturePosthog('stylist_qr_shared', { channel: 'copy' });

    expect(getPosthog()).toBe(client);
    expect(capture).toHaveBeenCalledWith('stylist_qr_shared', {
      channel: 'copy',
    });
  });

  it('preserves an explicit lifecycle UUID and original timestamp through the lazy queue', () => {
    const identity = {
      uuid: '11111111-1111-4111-8111-111111111111',
      timestamp: new Date('2026-10-20T12:00:00Z'),
    };
    capturePosthog(
      'email_lifecycle_entry',
      { lifecycle_cta: 'primary' },
      identity
    );
    const { client, capture } = fakePosthog();
    attachPosthog(client);
    expect(capture).toHaveBeenCalledWith(
      'email_lifecycle_entry',
      expect.objectContaining({ lifecycle_cta: 'primary' }),
      identity
    );
  });

  it('never lets a failing call escape to the caller', () => {
    const client = {
      capture: () => {
        throw new Error('blocked');
      },
    } as unknown as PostHog;
    attachPosthog(client);

    expect(() => capturePosthog('x')).not.toThrow();
    expect(() =>
      withPosthog(() => {
        throw new Error('blocked');
      })
    ).not.toThrow();
  });

  it('holds a bounded queue when PostHog never starts', () => {
    for (let index = 0; index < 500; index += 1) {
      capturePosthog(`event_${index}`);
    }
    const { client, capture } = fakePosthog();
    attachPosthog(client);

    expect(capture).toHaveBeenCalledTimes(200);
    expect(capture.mock.calls[0]?.[0]).toBe('event_0');
  });
});
