import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../client-device-storage/storage-keys.config';
import {
  CONSENT_DEFAULT_SCRIPT,
  CONSENT_DEFAULT_SCRIPT_CSP_HASH,
} from './consent-default-script';

interface TrackerWindow {
  dataLayer?: unknown[];
  gtag?: unknown;
  clarity?: ((...args: unknown[]) => void) & { q?: unknown[] };
}

const BOOTSTRAP_SOURCE = readFileSync(
  resolve(process.cwd(), 'public/analytics-bootstrap.js'),
  'utf8'
);

function trackerWindow(): TrackerWindow {
  return window as unknown as TrackerWindow;
}

function runInline(): void {
  // The inline script is the unit under test, evaluated as text.
  new Function(CONSENT_DEFAULT_SCRIPT)();
}

function runBootstrap(): void {
  const tag = document.createElement('script');
  tag.id = 'analytics-bootstrap';
  tag.setAttribute('data-gtm-id', 'GTM-TEST');
  document.head.appendChild(tag);
  new Function(BOOTSTRAP_SOURCE)();
}

/** `dataLayer` entries as plain arrays (gtag pushes `arguments` objects). */
function entries(): unknown[] {
  return (trackerWindow().dataLayer ?? []).map(entry =>
    entry !== null &&
    typeof entry === 'object' &&
    Object.prototype.toString.call(entry) === '[object Arguments]'
      ? Array.from(entry as ArrayLike<unknown>)
      : entry
  );
}

function consentCommands(kind: 'default' | 'update'): unknown[][] {
  return entries().filter(
    (entry): entry is unknown[] =>
      Array.isArray(entry) && entry[0] === 'consent' && entry[1] === kind
  );
}

describe('CONSENT_DEFAULT_SCRIPT', () => {
  afterEach(() => {
    document.cookie = 'nf_internal=; Path=/; Max-Age=0';
    document.head.querySelectorAll('script').forEach(node => node.remove());
    localStorage.clear();
    const w = trackerWindow();
    delete w.dataLayer;
    delete w.gtag;
    delete w.clarity;
    window.history.replaceState({}, '', '/');
  });

  it('pinned CSP hash matches sha256 of the rendered inline script', () => {
    const digest = createHash('sha256')
      .update(CONSENT_DEFAULT_SCRIPT, 'utf8')
      .digest('base64');
    expect(CONSENT_DEFAULT_SCRIPT_CSP_HASH).toBe(`'sha256-${digest}'`);
  });

  it('puts the consent default at index 0, ahead of events pushed later by app code', () => {
    runInline();
    trackerWindow().dataLayer?.push({ event: 'cta_click' });
    runBootstrap();

    const all = entries();
    expect(all[0]).toEqual([
      'consent',
      'default',
      {
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        analytics_storage: 'granted',
      },
    ]);
    // The bootstrap adds no second default and no update for a granted visit.
    expect(consentCommands('default')).toHaveLength(1);
    expect(consentCommands('update')).toHaveLength(0);
    expect(trackerWindow().clarity?.q?.[0]).toEqual(
      expect.objectContaining({
        0: 'consentv2',
        1: { ad_Storage: 'denied', analytics_Storage: 'granted' },
      })
    );
  });

  it('defaults analytics to denied when the stored banner choice refused it', () => {
    localStorage.setItem(
      STORAGE_KEYS.COOKIE_CONSENT,
      JSON.stringify({
        state: {
          consent: { necessary: true, analytics: false, marketing: false },
        },
        version: 0,
      })
    );

    runInline();

    expect(consentCommands('default')[0]?.[2]).toEqual(
      expect.objectContaining({ analytics_storage: 'denied' })
    );
  });

  it('lifts a stored refusal through an update when the loader runs after she accepted', () => {
    localStorage.setItem(
      STORAGE_KEYS.COOKIE_CONSENT,
      JSON.stringify({
        state: {
          consent: { necessary: true, analytics: false, marketing: false },
        },
      })
    );
    runInline();
    runBootstrap();

    expect(consentCommands('default')).toHaveLength(1);
    expect(consentCommands('update')[0]?.[2]).toEqual(
      expect.objectContaining({ analytics_storage: 'granted' })
    );
  });

  it('sets nothing for own traffic (cookie or the address switch)', () => {
    document.cookie = 'nf_internal=1; Path=/';
    runInline();
    expect(trackerWindow().dataLayer).toBeUndefined();
    expect(trackerWindow().clarity).toBeUndefined();

    document.cookie = 'nf_internal=; Path=/; Max-Age=0';
    window.history.replaceState({}, '', '/?nf_internal=1');
    runInline();
    expect(trackerWindow().dataLayer).toBeUndefined();
  });

  it('still sets the default when the address switches own traffic off', () => {
    document.cookie = 'nf_internal=1; Path=/';
    window.history.replaceState({}, '', '/?a=b&nf_internal=0');

    runInline();

    expect(consentCommands('default')).toHaveLength(1);
  });

  it('the bootstrap falls back to its own default when the inline script did not run', () => {
    trackerWindow().dataLayer = [{ event: 'cta_click' }];

    runBootstrap();

    expect(consentCommands('default')).toHaveLength(1);
  });
});
