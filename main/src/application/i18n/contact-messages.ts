import {
  BRAND_CONFIG,
  BRAND_CONTACT_ENCODED,
} from '@kernel/domain/platform/brand.config';
import { decodePii } from '@kernel/domain/contact/contact-obfuscation';

const contacts = Object.entries(BRAND_CONTACT_ENCODED);
const token = (key: string): string => `__NF_CONTACT_${key}__`;

/** Transform message leaves only; never touches user-generated account data. */
export function mapContactMessages<T>(
  value: T,
  mode: 'encode' | 'hidden' | 'revealed' | 'crawler'
): T {
  if (typeof value === 'string') {
    let result: string = value;
    for (const [key, encoded] of contacts) {
      if (mode === 'hidden') {
        result = result.replaceAll(token(key), '…');
        continue;
      }
      const address = decodePii(encoded);
      if (mode === 'encode') {
        result = result.replaceAll(address, token(key));
      } else if (mode === 'crawler') {
        result = result
          .replaceAll(address, `${BRAND_CONFIG.url}/contact`)
          .replaceAll(token(key), `${BRAND_CONFIG.url}/contact`);
      } else {
        result = result.replaceAll(token(key), address);
      }
    }
    return result as T;
  }
  if (Array.isArray(value)) {
    return value.map(item => mapContactMessages(item, mode)) as T;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        mapContactMessages(item, mode),
      ])
    ) as T;
  }
  return value;
}
