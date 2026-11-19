// session-user-agent.helper.test.ts
// Real User-Agent strings: Chromium-based browsers must not read as Chrome, and
// Safari must report its product version (Version/…), not the WebKit build.

import { describe, it, expect } from 'vitest';
import {
  describeSessionDevice,
  parseSessionBrowser,
  parseSessionOs,
} from './session-user-agent.helper';

const UA = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.2478.51',
  edgeAndroid:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 EdgA/124.0.2478.64',
  edgeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/124.2478.50 Mobile/15E148 Safari/605.1.15',
  opera:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/110.0.0.0',
  samsung:
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36',
  firefoxWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  firefoxIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/125.0 Mobile/15E148 Safari/605.1.15',
  chromeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  androidWebView:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Mobile Safari/537.36',
  curl: 'curl/8.4.0',
} as const;

describe('parseSessionBrowser', () => {
  it.each([
    [UA.chromeWindows, 'Chrome 124'],
    [UA.edgeWindows, 'Edge 124'],
    [UA.edgeAndroid, 'Edge 124'],
    [UA.edgeIos, 'Edge 124'],
    [UA.opera, 'Opera 110'],
    [UA.samsung, 'Samsung Internet 24'],
    [UA.firefoxWindows, 'Firefox 125'],
    [UA.firefoxIos, 'Firefox 125'],
    [UA.chromeIos, 'Chrome 124'],
    [UA.safariMac, 'Safari 17'],
    [UA.safariIphone, 'Safari 17'],
    [UA.androidWebView, 'Chrome 124'],
  ])('%s → %s', (ua, expected) => {
    expect(parseSessionBrowser(ua)).toBe(expected);
  });

  it('returns null for a non-browser client', () => {
    expect(parseSessionBrowser(UA.curl)).toBeNull();
  });
});

describe('parseSessionOs', () => {
  it.each([
    [UA.chromeWindows, 'Windows'],
    [UA.edgeAndroid, 'Android'],
    [UA.safariIphone, 'iOS'],
    [UA.safariMac, 'macOS'],
    [UA.androidWebView, 'Android'],
  ])('%s → %s', (ua, expected) => {
    expect(parseSessionOs(ua)).toBe(expected);
  });

  it('returns null when the UA names no system', () => {
    expect(parseSessionOs(UA.curl)).toBeNull();
  });
});

describe('describeSessionDevice', () => {
  it('joins browser and system', () => {
    expect(describeSessionDevice(UA.chromeWindows)).toBe('Chrome 124, Windows');
    expect(describeSessionDevice(UA.safariIphone)).toBe('Safari 17, iOS');
  });

  it('returns null for a missing or unreadable UA', () => {
    expect(describeSessionDevice(null)).toBeNull();
    expect(describeSessionDevice('')).toBeNull();
    expect(describeSessionDevice(UA.curl)).toBeNull();
  });
});
