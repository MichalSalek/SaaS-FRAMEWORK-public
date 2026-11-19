import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// The loader is a static file outside the bundle (public/analytics-bootstrap.js),
// so nothing else exercises its own-traffic gate. It is evaluated here as text.
const BOOTSTRAP_SOURCE = readFileSync(
  resolve(process.cwd(), 'public/analytics-bootstrap.js'),
  'utf8'
);

interface TrackerWindow {
  dataLayer?: unknown[];
  gtag?: unknown;
  clarity?: unknown;
}

function runBootstrap(): void {
  const tag = document.createElement('script');
  tag.id = 'analytics-bootstrap';
  tag.setAttribute('data-gtm-id', 'GTM-TEST');
  tag.setAttribute('data-clarity-id', 'clarity-test');
  document.head.appendChild(tag);
  // The static loader file is the unit under test, evaluated as text.
  new Function(BOOTSTRAP_SOURCE)();
}

function trackerScripts(): string[] {
  return [...document.querySelectorAll('script[src]')]
    .map(node => node.getAttribute('src') ?? '')
    .filter(src => /googletagmanager|clarity\.ms/.test(src));
}

describe('analytics-bootstrap.js own-traffic gate', () => {
  afterEach(() => {
    document.cookie = 'nf_internal=; Path=/; Max-Age=0';
    document.head.querySelectorAll('script').forEach(node => node.remove());
    const w = window as unknown as TrackerWindow;
    delete w.dataLayer;
    delete w.gtag;
    delete w.clarity;
    window.history.replaceState({}, '', '/');
  });

  it('loads GTM and Clarity for a visitor without the cookie', () => {
    runBootstrap();

    expect(trackerScripts()).toHaveLength(2);
  });

  it('loads no tracker when the own-traffic cookie is set', () => {
    document.cookie = 'nf_internal=1; Path=/';

    runBootstrap();

    expect(trackerScripts()).toHaveLength(0);
    expect((window as unknown as TrackerWindow).clarity).toBeUndefined();
  });

  it('loads no tracker on the very page view that sets the cookie through the address', () => {
    window.history.replaceState({}, '', '/?nf_internal=1');

    runBootstrap();

    expect(document.cookie).toContain('nf_internal=1');
    expect(trackerScripts()).toHaveLength(0);
    expect(window.location.search).toBe('');
  });

  it('loads the trackers again after the cookie is switched off through the address', () => {
    document.cookie = 'nf_internal=1; Path=/';
    window.history.replaceState({}, '', '/?nf_internal=0');

    runBootstrap();

    expect(document.cookie).not.toContain('nf_internal=1');
    expect(trackerScripts()).toHaveLength(2);
  });
});
