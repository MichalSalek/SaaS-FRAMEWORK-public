import { describe, expect, it } from 'vitest';
import { resolveMarketingVideo } from './marketingVideo.config';
import type {
  MarketingVideoAsset,
  MarketingVideoRegistry,
} from './marketingVideo.config';

const asset: MarketingVideoAsset = {
  id: 'kod-na-blacie',
  version: 'v1',
  src: '/media/kod-na-blacie/approved-en.mp4',
  approved: true,
  captionsBurnedIn: false,
  durationSeconds: 58,
  captions: {
    en: '/media/kod-na-blacie/en.vtt',
    de: '/media/kod-na-blacie/de.vtt',
  },
};
const registry: MarketingVideoRegistry = { pl: null, en: asset };

describe('approved marketing video resolution', () => {
  it('keeps the original hero until a locale film is approved', () => {
    expect(resolveMarketingVideo('pl')).toBeNull();
    expect(resolveMarketingVideo('en')).toBeNull();
    expect(resolveMarketingVideo('pl', registry)).toBeNull();
    expect(resolveMarketingVideo('fr', registry)).toBeNull();
  });
  it('uses English picture/audio with German captions, never Polish fallback', () => {
    expect(resolveMarketingVideo('de', registry)).toEqual({
      asset,
      videoLanguage: 'en',
      captionLanguage: 'de',
      uiLanguage: 'de',
    });
    expect(resolveMarketingVideo('en', registry)?.captionLanguage).toBe('en');
  });
  it('does not expose an English film on DE without the required subtitle track', () => {
    expect(
      resolveMarketingVideo('de', {
        ...registry,
        en: { ...asset, captions: { en: '/media/kod-na-blacie/en.vtt' } },
      })
    ).toBeNull();
  });
  it('rejects missing clean-caption metadata from an imported manifest', () => {
    const legacy = JSON.parse(JSON.stringify(asset)) as MarketingVideoAsset;
    Reflect.deleteProperty(legacy, 'captionsBurnedIn');
    expect(resolveMarketingVideo('en', { pl: null, en: legacy })).toBeNull();
  });
  it('rejects invalid durations', () => {
    expect(
      resolveMarketingVideo('en', {
        pl: null,
        en: { ...asset, durationSeconds: 0 },
      })
    ).toBeNull();
    expect(
      resolveMarketingVideo('en', {
        pl: null,
        en: { ...asset, durationSeconds: Number.NaN },
      })
    ).toBeNull();
  });
});
