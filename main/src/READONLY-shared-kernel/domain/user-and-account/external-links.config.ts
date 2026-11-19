/**
 * Profile links beyond the single website/Instagram fields.
 *
 * DECISION: a stylist may add up to three arbitrary https links (portfolio,
 * price list, booking service, maps). The product does not call them
 * "booking": the label is "Links" and the public profile names the detected
 * service. Detection is presentation-only; the stored value is always the
 * normalized URL, so a service rename cannot break the link.
 */
export const EXTERNAL_LINK_LIMIT = 3;

export const EXTERNAL_LINK_SERVICE_IDS = [
  'booksy',
  'fresha',
  'treatwell',
  'instagram',
  'facebook',
  'tiktok',
  'whatsapp',
  'maps',
  'website',
] as const;

export type ExternalLinkServiceId = (typeof EXTERNAL_LINK_SERVICE_IDS)[number];

export interface ExternalLinkService {
  id: ExternalLinkServiceId;
  label: string;
}

const SERVICES: ReadonlyArray<{
  id: Exclude<ExternalLinkServiceId, 'website'>;
  label: string;
  hosts: readonly string[];
}> = [
  {
    id: 'booksy',
    label: 'Booksy',
    hosts: ['booksy.com', 'booksy.net', 'booksy.pl'],
  },
  { id: 'fresha', label: 'Fresha', hosts: ['fresha.com'] },
  {
    id: 'treatwell',
    label: 'Treatwell',
    hosts: ['treatwell.com', 'treatwell.pl', 'treatwell.de', 'treatwell.co.uk'],
  },
  { id: 'instagram', label: 'Instagram', hosts: ['instagram.com'] },
  { id: 'facebook', label: 'Facebook', hosts: ['facebook.com', 'fb.com'] },
  { id: 'tiktok', label: 'TikTok', hosts: ['tiktok.com'] },
  { id: 'whatsapp', label: 'WhatsApp', hosts: ['wa.me', 'whatsapp.com'] },
  {
    id: 'maps',
    label: 'Google Maps',
    hosts: ['maps.google.com', 'maps.app.goo.gl'],
  },
];

/** Add https:// when the person pasted a bare host; never invent http. */
export function normalizeExternalLinkInput(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '';
  }
  return /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
}

const parsedHttps = (value: string): URL | null => {
  try {
    const parsed = new URL(normalizeExternalLinkInput(value));
    if (parsed.protocol !== 'https:' || parsed.hostname.length === 0) {
      return null;
    }
    if (parsed.username.length > 0 || parsed.password.length > 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export function isValidExternalLink(value: string): boolean {
  return parsedHttps(value) !== null;
}

/** Returns the normalized URL, or null when it is not a safe https link. */
export function normalizeExternalLink(value: string): string | null {
  const parsed = parsedHttps(value);
  return parsed === null ? null : parsed.toString();
}

export function sanitizeExternalLinks(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const normalized = normalizeExternalLink(item);
    if (normalized === null || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
    if (result.length === EXTERNAL_LINK_LIMIT) {
      break;
    }
  }
  return result;
}

export function detectExternalLinkService(value: string): ExternalLinkService {
  const parsed = parsedHttps(value);
  if (parsed === null) {
    return { id: 'website', label: '' };
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  for (const service of SERVICES) {
    if (
      service.hosts.some(
        candidate => host === candidate || host.endsWith(`.${candidate}`)
      )
    ) {
      return { id: service.id, label: service.label };
    }
  }
  return { id: 'website', label: '' };
}

/** A readable fallback label for an arbitrary https URL. */
export function formatExternalLinkLabel(value: string): string {
  const parsed = parsedHttps(value);
  if (parsed === null) {
    return '';
  }
  return `${parsed.hostname.replace(/^www\./i, '')}${parsed.pathname}`
    .replace(/\/+$/, '')
    .replace(/\/$/, '');
}
