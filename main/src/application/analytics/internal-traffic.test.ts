import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../client-device-storage/storage-keys.config';
import {
  applyInternalTrafficOverrideFromUrl,
  setInternalTrafficCookie,
  setInternalTrafficCookieForMasterAdmin,
} from './internal-traffic';

describe('internal traffic device choice', () => {
  afterEach(() => {
    window.localStorage.removeItem(STORAGE_KEYS.INTERNAL_TRAFFIC_OVERRIDE);
    document.cookie = 'nf_internal=; Path=/; Max-Age=0; SameSite=Lax';
    window.history.replaceState({}, '', '/');
  });

  it('keeps an explicit device opt-out ahead of automatic admin marking', () => {
    window.history.replaceState({}, '', '/?nf_internal=0');

    applyInternalTrafficOverrideFromUrl();
    setInternalTrafficCookieForMasterAdmin();

    expect(document.cookie).not.toContain('nf_internal=1');
    expect(
      window.localStorage.getItem(STORAGE_KEYS.INTERNAL_TRAFFIC_OVERRIDE)
    ).toBe('0');
    expect(window.location.search).toBe('');
  });

  it('marks a master admin device automatically without an explicit opt-out', () => {
    setInternalTrafficCookieForMasterAdmin();

    expect(document.cookie).toContain('nf_internal=1');
  });

  it('tells the trackers already running on the page to stop when the cookie appears', () => {
    const gtag = vi.fn();
    const clarity = vi.fn();
    const w = window as unknown as { gtag?: unknown; clarity?: unknown };
    w.gtag = gtag;
    w.clarity = clarity;
    try {
      setInternalTrafficCookie(true);
    } finally {
      delete w.gtag;
      delete w.clarity;
    }

    expect(gtag).toHaveBeenCalledWith(
      'consent',
      'update',
      expect.objectContaining({ analytics_storage: 'denied' })
    );
    expect(clarity).toHaveBeenCalledWith('stop');
  });

  it('leaves running trackers alone when the cookie is removed', () => {
    const gtag = vi.fn();
    const w = window as unknown as { gtag?: unknown };
    w.gtag = gtag;
    try {
      setInternalTrafficCookie(false);
    } finally {
      delete w.gtag;
    }

    expect(gtag).not.toHaveBeenCalled();
  });
});
