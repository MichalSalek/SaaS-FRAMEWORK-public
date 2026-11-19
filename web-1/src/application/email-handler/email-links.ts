/**
 * App links in lifecycle mail. Origin is `{{appUrl}}` (the renderer substitutes
 * vars.appUrl or BRAND_CONFIG.url). Callers pass paths from ROUTES_FRONT.
 *
 * UTM is added to every app link. Token links (magic, confirm, unsubscribe,
 * newsletter confirm) must NOT go through this helper.
 */

export type EmailUtmMedium = 'lifecycle' | 'transactional';

const APP_URL_TOKEN = '{{appUrl}}';

const appendUtm = (
  absolute: string,
  templateId: string,
  medium: EmailUtmMedium
): string => {
  if (absolute.includes('utm_source=')) {
    return absolute;
  }
  const sep = absolute.includes('?') ? '&' : '?';
  return `${absolute}${sep}utm_source=email&utm_medium=${encodeURIComponent(medium)}&utm_campaign=${encodeURIComponent(templateId)}`;
};

/**
 * Build an absolute app URL.
 *
 * When `appUrl` is already a deep link (listeners pass the concrete path as
 * appUrl), that path is kept and only UTM is added. When it is an origin, or
 * absent, `path` from ROUTES_FRONT is appended.
 */
export const buildAppHref = (args: {
  appUrl: string | undefined;
  path: string;
  templateId: string;
  medium: EmailUtmMedium;
  query?: Record<string, string | undefined>;
}): string => {
  const raw = args.appUrl?.trim() ?? '';
  let origin = APP_URL_TOKEN;
  let presetPath: string | null = null;

  if (raw && raw !== APP_URL_TOKEN) {
    try {
      const parsed = new URL(raw);
      origin = parsed.origin;
      if (parsed.pathname !== '/' && parsed.pathname !== '') {
        presetPath = `${parsed.pathname}${parsed.search}`;
      }
    } catch {
      origin = APP_URL_TOKEN;
    }
  }

  if (presetPath) {
    const absolute =
      origin === APP_URL_TOKEN
        ? `${APP_URL_TOKEN}${presetPath}`
        : `${origin}${presetPath}`;
    return appendUtm(absolute, args.templateId, args.medium);
  }

  const params = new URLSearchParams();
  if (args.query) {
    for (const [key, value] of Object.entries(args.query)) {
      if (value) {
        params.set(key, value);
      }
    }
  }
  params.set('utm_source', 'email');
  params.set('utm_medium', args.medium);
  params.set('utm_campaign', args.templateId);
  const path = args.path.startsWith('/') ? args.path : `/${args.path}`;
  return `${origin}${path}?${params.toString()}`;
};

/** Login that returns to a relative pay path. `loginPath` is ROUTES_FRONT.USER_LOG. */
export const buildLoginThenPath = (
  loginPath: string,
  payPathWithQuery: string
): string => {
  const from = payPathWithQuery.startsWith('/')
    ? payPathWithQuery
    : `/${payPathWithQuery}`;
  return `${loginPath}?from=${encodeURIComponent(from)}`;
};
