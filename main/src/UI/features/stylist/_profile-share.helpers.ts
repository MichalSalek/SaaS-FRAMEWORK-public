/** Profile URL without the tracking query (`?from=qr` must not travel onward). */
export function publicProfileShareUrl(location: {
  origin: string;
  pathname: string;
}): string {
  return `${location.origin}${location.pathname}`;
}

/** Share only a public profile and a selected public photo, never tracking parameters. */
export function publicProfilePhotoShareUrl(
  location: { origin: string; pathname: string },
  photoId: string
): string {
  const url = new URL(publicProfileShareUrl(location));
  url.searchParams.set('photo', photoId);
  return url.toString();
}
