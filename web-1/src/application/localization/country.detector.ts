import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import type { IncomingHttpHeaders } from 'node:http';
import {
  isCountryCode,
  type CountryCode,
} from '@kernel/domain/localization/country.config';
import { hasTrustedEdgeHeaders } from '@app/http/trust-aware-ip';

export const detectRequestCountry = (
  headers: IncomingHttpHeaders
): CountryCode | null => {
  if (
    headers.host?.toLowerCase() !== `api.${BRAND_CONFIG.domain}` ||
    !hasTrustedEdgeHeaders(headers, 'cloudflare')
  ) {
    return null;
  }
  const country = headers['cf-ipcountry'];
  if (
    typeof country !== 'string' ||
    !/^[A-Z]{2}$/.test(country) ||
    !isCountryCode(country)
  ) {
    return null;
  }
  return country;
};
