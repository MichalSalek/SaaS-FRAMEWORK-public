import { afterEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../client-device-storage/storage-keys.config';
import {
  appendFirstTouchToCallbackURL,
  captureFirstTouchFromUrl,
  FIRST_TOUCH_TTL_MS,
  readFirstTouch,
  updateFirstTouch,
} from './first-touch';

describe('first-touch storage', () => {
  afterEach(() => {
    window.localStorage.removeItem(STORAGE_KEYS.FIRST_TOUCH);
    window.history.replaceState({}, '', '/');
  });

  it('stores the first public landing and updates its CTA and method', () => {
    const now = Date.now();
    window.history.replaceState({}, '', '/en/for-stylists?utm_source=chatgpt');

    captureFirstTouchFromUrl(now);
    updateFirstTouch({ cta: 'get-app-sticky' });
    updateFirstTouch({ method: 'magic_link' });

    expect(readFirstTouch(now)).toEqual({
      capturedAt: now,
      src: 'chatgpt',
      landing: '/en/for-stylists',
      cta: 'get-app-sticky',
      method: 'magic_link',
    });
  });

  it('adopts callback attribution without replacing an existing local record', () => {
    window.history.replaceState(
      {},
      '',
      '/app?authCode=one-time&nf_ft=chatgpt%7C%2Fen%2Fpricing%7Chome-hero%7Cgoogle'
    );

    captureFirstTouchFromUrl(2_000);

    expect(readFirstTouch(2_000)).toEqual({
      capturedAt: 2_000,
      src: 'chatgpt',
      landing: '/en/pricing',
      cta: 'home-hero',
      method: 'google',
    });
    expect(window.location.search).toContain('authCode=one-time');
    expect(window.location.search).not.toContain('nf_ft');

    window.localStorage.setItem(
      STORAGE_KEYS.FIRST_TOUCH,
      JSON.stringify({
        capturedAt: 2_000,
        src: 'existing',
        landing: '/contact',
      })
    );
    window.history.replaceState(
      {},
      '',
      '/app?nf_ft=other%7C%2Fpricing%7Ccta%7Cmagic_link'
    );
    captureFirstTouchFromUrl(3_000);
    expect(readFirstTouch(3_000)?.src).toBe('existing');
  });

  it('expires attribution after 30 days and carries values on a relative callback', () => {
    const now = Date.now();
    window.history.replaceState({}, '', '/pricing?utm_source=chatgpt');
    captureFirstTouchFromUrl(now);
    expect(readFirstTouch(now + FIRST_TOUCH_TTL_MS + 1)).toBeNull();

    captureFirstTouchFromUrl();
    updateFirstTouch({ cta: 'pricing-tier', method: 'google' });
    const callback = appendFirstTouchToCallbackURL(
      '/en/app?role=stylist',
      'google'
    );
    expect(callback).toContain('role=stylist');
    expect(callback).toContain('nf_ft=');
  });
});
