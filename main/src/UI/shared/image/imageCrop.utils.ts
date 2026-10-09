// UI/shared/image/imageCrop.utils.ts
// Wycinanie kadru na canvasie — wspólne dla kadrowania zdjęcia stylizacji (3:4)
// i zdjęcia profilowego (kwadrat). Czyste funkcje, zero stanu i zero i18n:
// każdy ekran wnosi własne proporcje, teksty i przyciski.
//
// Powierzchnia publiczna modułu = `centeredAspectCrop` + `cropToFile`.
// `getCroppedBlob` i `croppedFileName` są krokami POŚREDNIMI `cropToFile` i nie
// mają wywołujących poza tym plikiem — trzymamy je module-private, żeby
// kontrakt modułu zgadzał się z jego opisem.

import {
  centerCrop,
  makeAspectCrop,
  type Crop,
  type PixelCrop,
} from 'react-image-crop';

/** Wyjściowy kadr: wyśrodkowane 90% szerokości w zadanych proporcjach. */
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
 * Wycina zaznaczony prostokąt w ROZDZIELCZOŚCI ORYGINAŁU (nie podglądu) — stąd
 * przeskalowanie przez `naturalWidth/width`. Bez tego kadr z miniatury na telefonie
 * wracałby jako obrazek szerokości podglądu.
 */
function getCroppedBlob(
  image: HTMLImageElement,
  pixelCrop: PixelCrop
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
      'image/jpeg',
      0.92
    );
  });
}

/**
 * Nazwa pliku po kadrze.
 *
 * DECISION (nie usuwaj tego komentarza): rozszerzenie idzie za ZAWARTOŚCIĄ, nie za
 * oryginałem — canvas zawsze eksportuje JPEG, więc `foto.png` wracało jako
 * `foto-crop.png` z bajtami JPEG w środku (Cloudinary to wybaczał, systemy plików
 * nie muszą).
 */
function croppedFileName(originalName: string, suffix: string): string {
  return `${originalName.replace(/\.[^.]+$/, '')}-${suffix}.jpg`;
}

/** Kadr → gotowy `File` (JPEG), nazwany po oryginale. */
export async function cropToFile(
  image: HTMLImageElement,
  pixelCrop: PixelCrop,
  originalName: string,
  suffix: string
): Promise<File> {
  const blob = await getCroppedBlob(image, pixelCrop);
  return new File([blob], croppedFileName(originalName, suffix), {
    type: 'image/jpeg',
  });
}
