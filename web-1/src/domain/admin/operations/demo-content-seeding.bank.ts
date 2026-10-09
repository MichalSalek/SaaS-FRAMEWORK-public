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
 * Odwołania do zdjęć banku demo PO NAZWIE pliku (bez sufiksu Cloudinary), nie
 * po indeksie. Indeks przesuwał się przy każdej zmianie banku (2026-09-16:
 * usunięcie 21 plików), a nazwa jest stabilna i czytelna w danych.
 */

/** 'https://…/demo-seed/nail-21-medium-red_wpqm4q.webp' → 'nail-21-medium-red'. */
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

/** Rzuca przy nazwie spoza banku: literówka w danych ma wybuchnąć, nie zniknąć. */
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
