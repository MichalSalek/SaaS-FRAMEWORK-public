import { describe, expect, it } from 'vitest';
import { LP_ASSETS } from './lpAssets';
import { responsiveImageSources } from './responsive-assets.config';

describe('pre-cut responsive variants', () => {
  it('serves the home hero screen as versioned AVIF with a WebP fallback', () => {
    const sources = responsiveImageSources(LP_ASSETS.app.appGalleryFeed.pl);
    const version = LP_ASSETS.app.appGalleryFeed.pl.split('?')[1];
    expect(sources?.avifSrcSet).toContain(
      `/img/lp/app/pl/appGalleryFeed-420w.avif?${version} 420w`
    );
    expect(sources?.webpSrcSet).toContain(
      `/img/lp/app/pl/appGalleryFeed-240w.webp?${version} 240w`
    );
    expect(sources?.fallbackSrc).toBe(
      `/img/lp/app/pl/appGalleryFeed-720w.webp?${version}`
    );
  });
  it('leaves an asset without variants to next/image', () => {
    expect(responsiveImageSources(LP_ASSETS.app.appDashboard.pl)).toBe(
      undefined
    );
  });
});
