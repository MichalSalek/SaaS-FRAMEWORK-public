import { describe, expect, it } from 'vitest';
import {
  getCloudinaryFrameSrcSet,
  getCloudinaryFrameUrl,
  getCloudinaryThumbUrl,
} from './cloudinary-url.utils';

const URL = 'https://res.cloudinary.com/demo/image/upload/v1/folder/photo.webp';

describe('cloudinary frame urls', () => {
  it('asks the CDN for the crop of the frame it is drawn in', () => {
    expect(getCloudinaryFrameUrl(URL, '3:4', 800)).toBe(
      'https://res.cloudinary.com/demo/image/upload/c_fill,ar_3:4,w_800,q_auto,f_auto/v1/folder/photo.webp'
    );
  });

  it('offers width candidates, so the browser picks by sizes and density', () => {
    const srcSet = getCloudinaryFrameSrcSet(URL, '1:1');
    expect(srcSet?.split(', ')).toHaveLength(4);
    expect(srcSet).toContain(
      'c_fill,ar_1:1,w_200,q_auto,f_auto/v1/folder/photo.webp 200w'
    );
    expect(srcSet).toContain('w_1200,q_auto,f_auto/v1/folder/photo.webp 1200w');
  });

  it('leaves a url the CDN cannot resize alone', () => {
    const foreign = 'https://example.test/photo.jpg';
    expect(getCloudinaryFrameUrl(foreign, '1:1', 400)).toBe(foreign);
    expect(getCloudinaryFrameSrcSet(foreign, '1:1')).toBeUndefined();
    expect(getCloudinaryThumbUrl(foreign, 400)).toBe(foreign);
  });
});
