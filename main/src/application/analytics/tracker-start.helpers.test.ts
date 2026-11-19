import { describe, expect, it } from 'vitest';
import {
  hasAttributionParams,
  resolveQuietAfterLoadMs,
  TRACKER_START,
} from './tracker-start.helpers';

describe('tracker start rules', () => {
  it('recognises campaign tags and ad click ids', () => {
    expect(hasAttributionParams('?utm_source=chatgpt.com')).toBe(true);
    expect(hasAttributionParams('?a=1&gclid=abc')).toBe(true);
    expect(hasAttributionParams('?FBCLID=abc')).toBe(true);
    expect(hasAttributionParams('?utm_campaign_id=1')).toBe(true);
  });

  it('ignores ordinary parameters', () => {
    expect(hasAttributionParams('')).toBe(false);
    expect(hasAttributionParams('?intent=register&role=stylist')).toBe(false);
    expect(hasAttributionParams('?nf_internal=1')).toBe(false);
    expect(hasAttributionParams('?utm=1')).toBe(false);
  });

  it('makes public pages wait, unless the address carries the source', () => {
    expect(resolveQuietAfterLoadMs('/', '?utm_source=chatgpt.com')).toBe(0);
    expect(resolveQuietAfterLoadMs('/pricing/', '?plan=pro')).toBe(
      TRACKER_START.QUIET_AFTER_LOAD_MS
    );
    expect(resolveQuietAfterLoadMs('/en/for-stylists/', '')).toBe(
      TRACKER_START.QUIET_AFTER_LOAD_MS
    );
  });

  it('starts every other screen at the first idle moment', () => {
    expect(resolveQuietAfterLoadMs('/user/login/', '')).toBe(0);
    expect(resolveQuietAfterLoadMs('/app/home/', '')).toBe(0);
    expect(resolveQuietAfterLoadMs('/privacy-policy/', '')).toBe(0);
  });
});
