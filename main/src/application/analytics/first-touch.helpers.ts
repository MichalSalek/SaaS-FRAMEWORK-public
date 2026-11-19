export type FirstTouchMethod = 'magic_link' | 'google';

export interface FirstTouchValues {
  src: string;
  landing: string;
  cta?: string;
  method?: FirstTouchMethod;
}

export interface FirstTouchInput {
  search: string;
  referrer: string;
  currentOrigin: string;
}

export function resolveFirstTouchSource({
  search,
  referrer,
  currentOrigin,
}: FirstTouchInput): string {
  const utmSource = new URLSearchParams(search).get('utm_source')?.trim();
  if (utmSource) {
    return utmSource;
  }

  if (referrer) {
    try {
      const externalReferrer = new URL(referrer);
      if (externalReferrer.origin !== currentOrigin) {
        return externalReferrer.hostname;
      }
    } catch {
      // Invalid referrers do not replace the explicit direct source.
    }
  }

  return '(direct)';
}

export function isPublicFirstTouchPath(pathname: string): boolean {
  const path = pathname.replace(/^\/(?:pl|en|de)(?=\/|$)/, '') || '/';
  return !/^\/(?:app|user|admin|api|dev|welcome|maintenance)(?:\/|$)/.test(
    path
  );
}

function sanitizeFirstTouchPart(
  value: string | undefined,
  maxLength: number
): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\|/g, '')
    .replace(/[^a-z0-9._/()|-]/g, '')
    .slice(0, maxLength);
}

export function serializeFirstTouch(values: FirstTouchValues): string {
  const src = sanitizeFirstTouchPart(values.src, 20);
  const landing = sanitizeFirstTouchPart(values.landing, 60);
  const cta = sanitizeFirstTouchPart(values.cta, 27);
  const method = sanitizeFirstTouchPart(values.method, 10);
  return [src, landing, cta, method].join('|');
}

export function parseFirstTouch(value: string): FirstTouchValues | null {
  if (value.length === 0 || value.length > 120) {
    return null;
  }

  const parts = value.split('|');
  const src = sanitizeFirstTouchPart(parts[0], 120);
  const landing = sanitizeFirstTouchPart(parts[1], 120);
  if (src.length === 0 || landing.length === 0) {
    return null;
  }

  const cta = sanitizeFirstTouchPart(parts[2], 120);
  const methodValue = sanitizeFirstTouchPart(parts[3], 120);
  const method: FirstTouchMethod | undefined =
    methodValue === 'magic_link' || methodValue === 'google'
      ? methodValue
      : undefined;

  return {
    src,
    landing,
    ...(cta.length > 0 ? { cta } : {}),
    ...(method !== undefined ? { method } : {}),
  };
}

export function appendFirstTouchToCallback(
  callbackURL: string,
  values: FirstTouchValues
): string {
  try {
    const callback = new URL(callbackURL, 'https://nailfolio.invalid');
    callback.searchParams.set('nf_ft', serializeFirstTouch(values));
    return `${callback.pathname}${callback.search}${callback.hash}`;
  } catch {
    return callbackURL;
  }
}
