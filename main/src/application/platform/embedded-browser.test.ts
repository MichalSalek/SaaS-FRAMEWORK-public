import { describe, expect, it } from 'vitest';
import { isEmbeddedSocialBrowser } from './embedded-browser';

const INSTAGRAM_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 Instagram 312.1.0.0.0';
const INSTAGRAM_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 312.0.0.0.0';
const FACEBOOK_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0.0.0]';
const FACEBOOK_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 [FBAN/FB4A;FBAV/450.0.0.0]';
const CHROME =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

describe('isEmbeddedSocialBrowser', () => {
  it('matches Instagram and Facebook in-app browsers and not the system browser', () => {
    expect(isEmbeddedSocialBrowser(INSTAGRAM_ANDROID)).toBe(true);
    expect(isEmbeddedSocialBrowser(INSTAGRAM_IOS)).toBe(true);
    expect(isEmbeddedSocialBrowser(FACEBOOK_IOS)).toBe(true);
    expect(isEmbeddedSocialBrowser(FACEBOOK_ANDROID)).toBe(true);
    expect(isEmbeddedSocialBrowser('something FBAV/1')).toBe(true);
    expect(isEmbeddedSocialBrowser(CHROME)).toBe(false);
    expect(isEmbeddedSocialBrowser(SAFARI)).toBe(false);
    expect(isEmbeddedSocialBrowser('')).toBe(false);
  });
});
