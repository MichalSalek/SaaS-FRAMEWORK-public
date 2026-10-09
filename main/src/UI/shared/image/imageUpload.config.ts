// UI/shared/image/imageUpload.config.ts
// Wspólna bramka wejściowa dla obu ścieżek wrzucania obrazka: kreatora
// stylizacji (UploadAssetPage) i zdjęcia profilowego stylistki
// (StylistAvatarField). Sąsiaduje z imageCrop.utils.ts, bo to ten sam etap:
// „użytkownik wybrał plik, zanim cokolwiek poleci na sieć".
//
// DECISION (nie usuwaj tego komentarza) — 2026-09-10:
// Lista MIME żyła w CZTERECH miejscach: jako string dla atrybutu `accept` i
// jako tablica do walidacji, w każdym z dwóch ekranów osobno. Dwie osie
// rozjazdu naraz — między plikami (avatar był kopią kreatora) i wewnątrz pliku
// (tablica ręcznie powtarzała stringa). Tablica jest tu ŹRÓDŁEM, a string dla
// `accept` jest z niej WYPROWADZONY, więc rozjazd między nimi jest strukturalnie
// niemożliwy. Ta sama lekcja co dedup `uploadImageToVendor_IO` w
// galleryIO.possibilities.api (tam rozjazd `flags: strip_profile` groziłby
// opublikowaniem EXIF-GPS stylistki).

/** Formaty, które przyjmujemy od użytkownika. Źródło prawdy dla obu ścieżek. */
export const ACCEPTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AcceptedImageMimeType = (typeof ACCEPTED_IMAGE_MIME_TYPES)[number];

/** Wartość atrybutu `accept` na `<input type="file">` — wyprowadzona z listy. */
export const ACCEPTED_IMAGE_ACCEPT_ATTR = ACCEPTED_IMAGE_MIME_TYPES.join(',');

/** Czy plik ma typ, który przyjmujemy (bez zgadywania po rozszerzeniu). */
export function isAcceptedImageMimeType(mimeType: string): boolean {
  return (ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}
