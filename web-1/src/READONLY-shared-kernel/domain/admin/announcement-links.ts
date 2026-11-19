import { BRAND_CONFIG } from '../platform/brand.config';

export type AnnouncementPart = { text: string; href?: string };

/** Only web links and root-relative paths are actionable; HTML stays literal text. */
export function safeAnnouncementHref(value: string): string | undefined {
  if (
    Array.from(value).some(
      character =>
        character.charCodeAt(0) <= 32 ||
        character.charCodeAt(0) === 127 ||
        character === '\\'
    )
  ) {
    return undefined;
  }
  if (value.startsWith('/') && !value.startsWith('//')) {
    return value;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) {
      return undefined;
    }
    if (
      url.hostname === BRAND_CONFIG.domain &&
      (url.port === '' || url.port === '443')
    ) {
      if (url.pathname.startsWith('//')) {
        return undefined;
      }
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

export function parseAnnouncementLinks(message: string): AnnouncementPart[] {
  const pattern = /\[([^\]\n]+)\]\(([^)\n]+)\)|https:\/\/[^\s<>[\]]+/gu;
  const parts: AnnouncementPart[] = [];
  let offset = 0;
  for (const match of message.matchAll(pattern)) {
    const start = match.index;
    if (start > offset) {
      parts.push({ text: message.slice(offset, start) });
    }
    const raw = match[0];
    const destination = match[2] ?? raw.replace(/[.,;!?]+$/u, '');
    const href = safeAnnouncementHref(destination);
    parts.push(
      href === undefined
        ? { text: raw }
        : { text: match[1] ?? destination, href }
    );
    if (match[2] === undefined && destination.length < raw.length) {
      parts.push({ text: raw.slice(destination.length) });
    }
    offset = start + raw.length;
  }
  if (offset < message.length) {
    parts.push({ text: message.slice(offset) });
  }
  return parts;
}

export const announcementPlainText = (message: string): string =>
  parseAnnouncementLinks(message)
    .map(part => part.text)
    .join('');

export const announcementPrimaryHref = (message: string): string | null =>
  parseAnnouncementLinks(message).find(part => part.href !== undefined)?.href ??
  null;
