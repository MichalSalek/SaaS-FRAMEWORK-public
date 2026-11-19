// UI/shared/image/imageCrop.utils.ts
// Canvas crop shared by the styling-photo crop (3:4) and the profile photo (square). Pure
// functions, no state, no i18n: each screen brings its own proportions, texts and buttons.
//
// Public surface = `centeredAspectCrop` + `cropToFile`. `getCroppedBlob` and `croppedFileName`
// are INTERMEDIATE steps of `cropToFile` with no callers outside this file, so they stay
// module-private to keep the module contract equal to its description.

import {
  centerCrop,
  makeAspectCrop,
  type Crop,
  type PixelCrop,
} from 'react-image-crop';

/** Initial crop: centred, 90% of the width, in the given aspect ratio. */
export function centeredAspectCrop(
  imgWidth: number,
  imgHeight: number,
  aspect: number
): Crop {
  return centerCrop(
    makeAspectCrop({ unit: '%', width: 90 }, aspect, imgWidth, imgHeight),
    imgWidth,
    imgHeight
  );
}

/**
 * Cuts the selected rectangle at the ORIGINAL's resolution (not the preview's), hence the
 * rescale by `naturalWidth/width`. Without it a crop from a phone thumbnail would come back as an
 * image of the preview's width.
 */
function getCroppedBlob(
  image: HTMLImageElement,
  pixelCrop: PixelCrop,
  format: 'image/jpeg' | 'image/png'
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;
  canvas.width = pixelCrop.width * scaleX;
  canvas.height = pixelCrop.height * scaleY;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2d context unavailable');
  }

  ctx.drawImage(
    image,
    pixelCrop.x * scaleX,
    pixelCrop.y * scaleY,
    pixelCrop.width * scaleX,
    pixelCrop.height * scaleY,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas toBlob returned null'));
        }
      },
      format,
      0.92
    );
  });
}

/**
 * File name after the crop.
 *
 * The extension follows the CONTENT, not the original: the canvas always
 * exports JPEG, so keeping `.png` would mislabel the bytes.
 */
function croppedFileName(
  originalName: string,
  suffix: string,
  format: 'image/jpeg' | 'image/png'
): string {
  return `${originalName.replace(/\.[^.]+$/, '')}-${suffix}.${format === 'image/png' ? 'png' : 'jpg'}`;
}

/** Crop -> ready `File` (JPEG), named after the original. */
export async function cropToFile(
  image: HTMLImageElement,
  pixelCrop: PixelCrop,
  originalName: string,
  suffix: string,
  format: 'image/jpeg' | 'image/png' = 'image/jpeg'
): Promise<File> {
  const blob = await getCroppedBlob(image, pixelCrop, format);
  return new File([blob], croppedFileName(originalName, suffix, format), {
    type: format,
  });
}
