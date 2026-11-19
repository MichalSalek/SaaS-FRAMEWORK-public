import type { IncomingHttpHeaders } from 'node:http';
import { hasTrustedEdgeHeaders } from '@app/http/trust-aware-ip';
import { PAIR_REQUEST_PLACE_MAX } from '@kernel/domain/pairing/pairing.contract-schemas';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';

const API_HOST = `api.${BRAND_CONFIG.domain}`;
const INVALID_NAMES = new Set(['unknown', 'undefined', 'null', 'n/a', 'none']);

// Node's HTTP parser exposes raw UTF-8 header bytes as Latin-1. Decode only when
// the byte sequence is valid UTF-8; already-decoded Latin-1 text remains intact.
const decodeHeaderUtf8 = (value: string): string => {
  if ([...value].some(character => character.charCodeAt(0) > 255)) {
    return value;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.from(value, 'latin1')
    );
  } catch {
    return value;
  }
};

/** Only the location derived by our Cloudflare zone may enrich a request. */
export const resolvePairRequestPlace = (
  suppliedPlace: string | undefined,
  headers: IncomingHttpHeaders
): string | undefined => {
  if (suppliedPlace?.trim()) {
    return suppliedPlace;
  }
  if (
    typeof headers.host !== 'string' ||
    headers.host.toLowerCase() !== API_HOST ||
    !hasTrustedEdgeHeaders(headers, 'cloudflare')
  ) {
    return undefined;
  }
  const raw = headers['cf-ipcity'];
  if (typeof raw !== 'string' || raw.length > PAIR_REQUEST_PLACE_MAX * 9) {
    return undefined;
  }
  try {
    const city = decodeURIComponent(decodeHeaderUtf8(raw)).trim();
    if (
      city.length === 0 ||
      city.length > PAIR_REQUEST_PLACE_MAX ||
      INVALID_NAMES.has(city.toLowerCase()) ||
      !/\p{L}/u.test(city) ||
      !/^[\p{L}\p{M}\p{N} .'’-]+$/u.test(city)
    ) {
      return undefined;
    }
    return city;
  } catch {
    return undefined;
  }
};
