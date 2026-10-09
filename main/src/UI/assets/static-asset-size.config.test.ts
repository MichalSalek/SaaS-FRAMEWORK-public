import { describe, expect, it } from 'vitest';
import { LP_ASSETS } from './lpAssets';
import { staticAssetWidth } from './static-asset-size.config';

describe('reviewed source dimensions', () => {
  it('resolves a versioned illustration at its native derivative width', () => {
    expect(staticAssetWidth(LP_ASSETS.process.clientBeforeVisit, 1)).toBe(1774);
  });
  it('keeps a declared fallback for unknown external images', () => {
    expect(staticAssetWidth('https://example.test/portrait.png', 1440)).toBe(
      1440
    );
  });
});
