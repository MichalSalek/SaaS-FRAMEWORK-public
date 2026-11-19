import {
  BRAND_CONTACT_ENCODED,
  BRAND_CONFIG,
} from '@kernel/domain/platform/brand.config';
import { decodePii } from '@kernel/domain/contact/contact-obfuscation';
import { useTrustedInteraction } from '../../shared/interaction/trusted-interaction';

/** A useful contact-page fallback before the trusted-input gate opens. */
export function usePublicContact(kind: keyof typeof BRAND_CONTACT_ENCODED) {
  const trusted = useTrustedInteraction();
  const address = trusted ? decodePii(BRAND_CONTACT_ENCODED[kind]) : '';
  return {
    address,
    withSubject: (subject: string) =>
      address
        ? `mailto:${address}?subject=${encodeURIComponent(subject)}`
        : `${BRAND_CONFIG.url}/contact`,
    text: address || '…',
    href: address ? `mailto:${address}` : `${BRAND_CONFIG.url}/contact`,
  };
}
