/**
 * Raw Instagram input -> bare account name: trims, drops a leading „@” and
 * unwraps a pasted profile URL (`https://www.instagram.com/anna.nails/?hl=pl`
 * -> `anna.nails`). Stylists copy the link from the app as often as they type
 * the name. Empty string = no handle.
 */
export function normalizeInstagramHandle(raw: string): string {
  const trimmed = raw.trim();
  const path = /instagram\.com\/([^?#\s]*)/i.exec(trimmed)?.[1];
  if (path === undefined) {
    return trimmed.replace(/^@+/, '');
  }
  const [first = '', second = ''] = path.split('/');

  if (first.toLowerCase() === 'stories') {
    return second.replace(/^@+/, '');
  }
  if (INSTAGRAM_NON_ACCOUNT_PATHS.has(first.toLowerCase())) {
    return trimmed;
  }
  return first.replace(/^@+/, '');
}

/** First path segments of instagram.com that are not an account name. */
const INSTAGRAM_NON_ACCOUNT_PATHS: ReadonlySet<string> = new Set([
  'p',
  'reel',
  'reels',
  'tv',
  'explore',
  'accounts',
  'direct',
  'share',
  's',
  '',
]);

/**
 * Raw website input -> the https URL the server accepts. Stylists type
 * `velvet-nails.example.com` far more often than `https://velvet-nails.example.com`, and the
 * server takes https only, so the scheme is added (and `http://` raised to
 * https) here instead of asking her for it. Empty string = no website.
 */
export function normalizeWebsiteUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return '';
  }
  if (/^https:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed.replace(/^http:\/\//i, '')}`;
}
