/**
 * StylistPhoneContact: the stylist's public phone with a PII
 * reveal-on-interaction mechanism (the number is ENCODED server-side; we decode only
 * after the user's first trusted interaction, a bot/scraper sees „…").
 *
 * The card lives in the „cancel request" dialog (CTA „Zadzwoń"). On the
 * public profile the same number is a row of the „Kontakt" section
 * (StylistProfileContactMolecule), with the same reveal rule.
 *
 * A click on „Zadzwoń" is ITSELF a trusted interaction (a human), so we decode to
 * `tel:` in onClick regardless of the reveal state: it works even when the user
 * reached the button without a prior interaction.
 */

import { useTranslations } from 'next-intl';
import { PhoneCallIcon } from '@phosphor-icons/react';
import { decodePii } from '../../components/Pii/pii.crypto';
import { useTrustedInteraction } from '../../shared/interaction/trusted-interaction';
import styles from './StylistPhoneContact.module.css';

export const PHONE_PLACEHOLDER = '…';

/** Decode and dial. Shared with the phone row of the profile's „Kontakt”
 *  section (StylistProfileContactMolecule), so the reveal rule has one
 *  implementation. */
export function callStylistPhone(
  e: React.MouseEvent<HTMLElement>,
  encPhone: string
) {
  // A click = a trusted interaction → decode and dial even before the reveal.
  e.preventDefault();
  window.location.href = `tel:${decodePii(encPhone)}`;
}

export function StylistPhoneContactMolecule({
  encPhone,
  className,
}: {
  encPhone: string;
  className?: string;
}) {
  const t = useTranslations('stylist.contact');
  const revealed = useTrustedInteraction();

  const handleCall = (e: React.MouseEvent<HTMLAnchorElement>) =>
    callStylistPhone(e, encPhone);

  return (
    <div className={`${styles.contact}${className ? ` ${className}` : ''}`}>
      <span className={styles.label}>{t('phoneLabel')}</span>
      <span className={styles.number} suppressHydrationWarning>
        {revealed ? decodePii(encPhone) : PHONE_PLACEHOLDER}
      </span>
      <a
        href={revealed ? `tel:${decodePii(encPhone)}` : '#'}
        className={styles.callButton}
        onClick={handleCall}>
        <PhoneCallIcon size={16} weight='fill' />
        {t('call')}
      </a>
    </div>
  );
}
