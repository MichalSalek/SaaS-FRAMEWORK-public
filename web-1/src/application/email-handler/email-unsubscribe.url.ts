import type { EmailCategory } from '@kernel/domain/email/email-schedule.config';
import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import { buildFrontendBaseUrl } from '@app/environment/environment.utils.api';
import { generateUnsubscribeToken } from './email-unsubscribe.token';

/**
 * Build the full one-click unsubscribe URL for a lifecycle/transactional email.
 *
 * Single SSOT for the `/api/v1/email/unsubscribe?token=...` link used in
 * `List-Unsubscribe` headers (RFC 2369 + RFC 8058) and visible footer links.
 *
 * `locale` localizes the frontend unsubscribe landing page the GET endpoint
 * redirects to (Next i18n path prefix for non-default locales); pass the
 * locale already resolved for the email body. Omitted -> endpoint falls back
 * to the kernel default locale. Pattern parity: newsletter-broadcast.helpers.ts.
 *
 * Base URL (incl. optional port) comes from buildFrontendBaseUrl() — in this
 * architecture frontend (main/) and backend (web-1/) share one public domain,
 * and API routes (/api/v1/*) are served by the backend via proxy/shared domain.
 * If they ever split to separate domains, introduce BACKEND_PUBLIC_DOMAIN.
 */
export const buildEmailUnsubscribeUrl = (
  userId: string,
  category: EmailCategory,
  locale?: LocaleType
): string => {
  const token = generateUnsubscribeToken(userId, category);
  const localeSuffix = locale !== undefined ? `&locale=${locale}` : '';
  return `${buildFrontendBaseUrl()}/api/v1/email/unsubscribe?token=${encodeURIComponent(token)}${localeSuffix}`;
};
