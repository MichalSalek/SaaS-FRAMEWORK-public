import { createHmac } from 'node:crypto';
import { domainToASCII } from 'node:url';
import { ENV_VARS } from '@app/environment/environment.config';

/**
 * Canonical mailbox for THROTTLING only (never for storage, display or delivery).
 *
 * Every spelling that lands in the same inbox must share one budget, otherwise a flood just
 * rotates the spelling: case, surrounding and invisible whitespace, full-width or other
 * compatibility characters (NFKC), a `+tag` (delivered to the base mailbox by Gmail, Outlook,
 * iCloud, Fastmail, Proton and most hosts), Gmail's ignored dots and its `googlemail.com` alias,
 * a trailing dot on the domain and Unicode domains (punycode). Over-merging is the safe direction
 * here: two real people never differ only by a `+tag`, and a merged budget cannot be used to
 * lock out a different person.
 */
// Soft hyphen, Mongolian vowel separator, zero-width and directional marks, word joiners, BOM.
const INVISIBLE_CODE_POINTS = new Set([
  0x00ad, 0x180e, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0x2061,
  0x2062, 0x2063, 0x2064, 0xfeff,
]);
const stripInvisible = (value: string): string =>
  Array.from(value)
    .filter(
      ch =>
        !/\s/u.test(ch) && !INVISIBLE_CODE_POINTS.has(ch.codePointAt(0) ?? 0)
    )
    .join('');
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

export const normalizeEmailForThrottle = (raw: string): string | null => {
  const compact = stripInvisible(raw.normalize('NFKC'));
  const at = compact.lastIndexOf('@');
  if (at <= 0 || at === compact.length - 1) {
    return null;
  }
  let local = compact.slice(0, at).toLowerCase();
  const rawDomain = compact
    .slice(at + 1)
    .toLowerCase()
    .replace(/\.+$/u, '');
  const domain = domainToASCII(rawDomain) || rawDomain;
  if (!domain) {
    return null;
  }

  const plus = local.indexOf('+');
  if (plus > 0) {
    local = local.slice(0, plus);
  }
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./gu, '');
    return local ? `${local}@gmail.com` : null;
  }
  return local ? `${local}@${domain}` : null;
};

/**
 * Opaque key part: an HMAC keyed by the auth secret, so the counter table holds neither an address
 * nor an IP, and a known address cannot be looked up in it by hashing a guess.
 */
export const throttleKeyPart = (value: string): string =>
  createHmac('sha256', ENV_VARS.BETTER_AUTH_SECRET)
    .update(value)
    .digest('hex')
    .slice(0, 32);
