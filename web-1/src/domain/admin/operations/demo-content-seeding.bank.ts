import { resolveDemoAssetUrl } from './demo-content-seeding.config';
import {
  DEMO_PHOTOS_ANIA,
  type DemoPhoto,
} from './demo-content-seeding.photos';
import {
  DEMO_PHOTOS_OLA,
  DEMO_PHOTOS_NINA,
} from './demo-content-seeding.photos-guests';

/**
 * Demo photo-bank references by file name (no Cloudinary suffix), not by index.
 * The index moved whenever the bank changed (21 files removed on 2026-09-16).
 * The name stays stable and is readable in the data.
 */

/** 'https://…/demo-seed/portfolio-sample-036_rev3.webp' → 'portfolio-sample-036'. */
export const demoPhotoBaseName = (url: string): string | null =>
  /demo-seed\/(.+)_[a-z0-9]+\.webp$/.exec(url)?.[1] ?? null;

const DEMO_PHOTO_BANK: readonly DemoPhoto[] = [
  ...DEMO_PHOTOS_ANIA,
  ...DEMO_PHOTOS_OLA,
  ...DEMO_PHOTOS_NINA,
];

/** Pełne URL-e wszystkich zdjęć banku (klucz sprzątania prac przeniesionych między kontami). */
export const DEMO_BANK_ASSET_URLS: ReadonlySet<string> = new Set(
  DEMO_PHOTO_BANK.map(p => resolveDemoAssetUrl(p.asset_url))
);

/** Throws on a name outside the bank: a typo in the data must blow up, not vanish. */
export const demoPhotosByName = (names: readonly string[]): DemoPhoto[] =>
  names.map(name => {
    const photo = DEMO_PHOTO_BANK.find(
      p => demoPhotoBaseName(p.asset_url) === name
    );
    if (!photo) {
      throw new Error(`Demo photo "${name}" is not in the photo bank`);
    }
    return photo;
  });
