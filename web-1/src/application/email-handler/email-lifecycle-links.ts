import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { escapeHtml } from './email.utils';

export const EMAIL_LIFECYCLE_CTA_IDS = [
  'primary',
  'secondary',
  'app',
  'support',
  'brand',
] as const;

/** Only ordinary app links carry context; bearer and unsubscribe URLs stay untouched. */
export const trackLifecycleEmailLinks = (
  html: string,
  messageId: string
): string => {
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) {
    return html;
  }
  return html.replace(/href="([^"]+)"/g, (match, encoded: string) => {
    let url: URL;
    try {
      url = new URL(encoded.replace(/&amp;/g, '&'));
    } catch {
      return match;
    }
    if (url.origin !== new URL(BRAND_CONFIG.url).origin) {
      return match;
    }
    if (['token', 'authCode', 'code'].some(key => url.searchParams.has(key))) {
      return match;
    }
    const path = url.pathname.replace(/^\/(en|de)(?=\/|$)/, '') || '/';
    if (
      path === ROUTES_FRONT.USER_LOG ||
      path.includes('/unsubscribe') ||
      path.startsWith('/api/')
    ) {
      return match;
    }
    const ctaId =
      url.searchParams.get('nf_cta') ??
      (path === ROUTES_FRONT.APP
        ? 'app'
        : path === ROUTES_FRONT.CONTACT
          ? 'support'
          : path === '/'
            ? 'brand'
            : 'primary');
    if (!EMAIL_LIFECYCLE_CTA_IDS.some(id => id === ctaId)) {
      return match;
    }
    url.searchParams.set('nf_message', messageId);
    url.searchParams.set('nf_cta', ctaId);
    if (!url.searchParams.has('utm_source')) {
      url.searchParams.set('utm_source', 'email');
    }
    if (!url.searchParams.has('utm_medium')) {
      url.searchParams.set('utm_medium', 'lifecycle');
    }
    return `href="${escapeHtml(url.toString())}"`;
  });
};
