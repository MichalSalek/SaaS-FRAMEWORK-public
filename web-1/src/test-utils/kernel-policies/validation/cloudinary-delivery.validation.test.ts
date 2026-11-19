import { expect, it } from 'vitest';
import {
  CLOUDINARY_UPLOAD_URL_PREFIX,
  isCloudinaryAssetUrl,
} from '@kernel/policies/validation/validation.utils';

it.each(['../', '../../', './', 'folder/../', '%2e%2e/'])(
  'rejects path normalization before a Cloudinary upload: %s',
  segment => {
    expect(
      isCloudinaryAssetUrl(
        `${CLOUDINARY_UPLOAD_URL_PREFIX}${segment}image/fetch/https://evil.example/upload/v123/image.jpg`
      )
    ).toBe(false);
  }
);

it('keeps canonical uploads and transformation segments valid', () => {
  expect(
    isCloudinaryAssetUrl(
      `${CLOUDINARY_UPLOAD_URL_PREFIX}w_200,h_200/c_fill/v123/folder/image.jpg`
    )
  ).toBe(true);
});
