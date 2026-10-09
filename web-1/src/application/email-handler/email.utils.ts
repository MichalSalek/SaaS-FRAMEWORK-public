/**
 * Email utility functions
 */

/**
 * SSOT: Normalize email for case-insensitive, whitespace-safe lookups.
 *
 * Used everywhere:
 * - User registration
 * - Stripe customer lookup
 * - Webhook email matching
 * - Email alias storage
 *
 * @param email - Raw email string
 * @returns Normalized email (lowercase, trimmed)
 */
export const normalizeEmail = (email: string): string => {
  return email.toLowerCase().trim();
};

/**
 * Escape HTML entities to prevent XSS in email templates.
 *
 * @param str - String to escape
 * @returns Escaped string safe for HTML
 */
export const escapeHtml = (str: string): string => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

/**
 * Truncate string to max length with ellipsis.
 *
 * @param str - String to truncate
 * @param maxLength - Maximum length
 * @returns Truncated string
 */
const truncateString = (str: string, maxLength: number): string => {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength - 3) + '...';
};

/**
 * An alert link must be an absolute http(s) URL with a label. Anything else
 * is dropped rather than thrown: the alert itself matters more than its link.
 */
const sanitizeAlertLink = (
  link: { label: string; url: string } | undefined
): { label: string; url: string } | null => {
  if (!link) {
    return null;
  }
  const label = link.label.trim().slice(0, 120);
  let url: URL;
  try {
    url = new URL(link.url);
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !label) {
    return null;
  }
  return { label, url: url.toString() };
};

/**
 * Validate and sanitize alert parameters.
 *
 * @param params - Alert parameters to validate
 * @returns Sanitized parameters
 * @throws Error if validation fails
 */
export const validateAlertParams = (params: {
  alertTitle: string;
  alertMessage: string;
  lines?: readonly string[] | undefined;
  link?: { label: string; url: string } | undefined;
  details: Record<string, unknown>;
}): {
  alertTitle: string;
  alertMessage: string;
  lines: string[];
  link: { label: string; url: string } | null;
  details: Record<string, unknown>;
} => {
  const MAX_TITLE_LENGTH = 200;
  const MAX_MESSAGE_LENGTH = 1000;
  const MAX_LINES = 100;
  const MAX_LINE_LENGTH = 300;
  const MAX_DETAILS_SIZE = 10000; // ~10KB JSON

  if (!params.alertTitle || params.alertTitle.trim().length === 0) {
    throw new Error('Alert title is required');
  }

  if (!params.alertMessage || params.alertMessage.trim().length === 0) {
    throw new Error('Alert message is required');
  }

  const detailsJson = JSON.stringify(params.details);
  if (detailsJson.length > MAX_DETAILS_SIZE) {
    throw new Error(`Alert details too large (max ${MAX_DETAILS_SIZE} bytes)`);
  }

  return {
    alertTitle: truncateString(params.alertTitle.trim(), MAX_TITLE_LENGTH),
    alertMessage: truncateString(
      params.alertMessage.trim(),
      MAX_MESSAGE_LENGTH
    ),
    lines: (params.lines ?? [])
      .slice(0, MAX_LINES)
      .map(line => truncateString(line.trim(), MAX_LINE_LENGTH))
      .filter(line => line.length > 0),
    link: sanitizeAlertLink(params.link),
    details: params.details,
  };
};
