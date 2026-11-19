import { describe, expect, it } from 'vitest';
import {
  appendFirstTouchToCallback,
  isPublicFirstTouchPath,
  parseFirstTouch,
  resolveFirstTouchSource,
  serializeFirstTouch,
} from './first-touch.helpers';

describe('first-touch helpers', () => {
  it('prefers utm_source, then an external referrer host, then direct', () => {
    expect(
      resolveFirstTouchSource({
        search: '?utm_source=ChatGPT',
        referrer: 'https://search.example/results',
        currentOrigin: 'https://nailfolio.app',
      })
    ).toBe('ChatGPT');
    expect(
      resolveFirstTouchSource({
        search: '',
        referrer: 'https://search.example/results',
        currentOrigin: 'https://nailfolio.app',
      })
    ).toBe('search.example');
    expect(
      resolveFirstTouchSource({
        search: '',
        referrer: 'https://nailfolio.app/pricing',
        currentOrigin: 'https://nailfolio.app',
      })
    ).toBe('(direct)');
  });

  it('accepts public localized routes and excludes account routes', () => {
    expect(isPublicFirstTouchPath('/en/for-stylists')).toBe(true);
    expect(isPublicFirstTouchPath('/stylist/public-name')).toBe(true);
    expect(isPublicFirstTouchPath('/en/app/onboarding')).toBe(false);
    expect(isPublicFirstTouchPath('/user/login')).toBe(false);
  });

  it('sanitizes and bounds callback attribution to 120 characters', () => {
    const value = serializeFirstTouch({
      src: 'ChatGPT !!!',
      landing: '/en/for-stylists',
      cta: 'get-app-sticky',
      method: 'magic_link',
    });
    expect(value).toBe('chatgpt|/en/for-stylists|get-app-sticky|magic_link');
    expect(value).toMatch(/^[a-z0-9._/()|-]+$/);
    const longSource = serializeFirstTouch({
      src: 'x'.repeat(200),
      landing: '/pricing',
      cta: 'get-app-stylists-link',
      method: 'magic_link',
    });
    expect(longSource).toHaveLength(62);
    expect(longSource).toContain('|get-app-stylists-link|magic_link');
  });

  it('adopts only recognized callback fields and appends without losing query', () => {
    expect(parseFirstTouch('chatgpt|/pricing|home-hero|google')).toEqual({
      src: 'chatgpt',
      landing: '/pricing',
      cta: 'home-hero',
      method: 'google',
    });
    expect(parseFirstTouch('|||')).toBeNull();

    const callback = appendFirstTouchToCallback(
      '/en/app/onboarding?role=stylist#next',
      {
        src: 'chatgpt',
        landing: '/pricing',
        cta: 'home-hero',
        method: 'google',
      }
    );
    expect(callback).toContain('role=stylist');
    expect(callback).toContain('nf_ft=');
    expect(callback).toContain('#next');
  });
});
