/**
 * StylistPhoneContact — publiczny telefon stylistki z mechanizmem PII
 * reveal-on-interaction (numer jest ZAKODOWANY server-side; odkodowujemy dopiero
 * po pierwszej zaufanej interakcji użytkownika — bot/scraper widzi „…").
 *
 * Karta żyje w dialogu „anuluj prośbę" (CTA „Zadzwoń", patrz O1/D). Na
 * publicznym profilu ten sam numer jest wierszem sekcji „Kontakt"
 * (StylistProfileContactMolecule), z tą samą regułą odsłaniania.
 *
 * Klik w „Zadzwoń" SAM jest zaufaną interakcją (człowiek), więc dekodujemy do
 * `tel:` w onClick niezależnie od stanu reveal — działa nawet gdy użytkownik
 * dotarł do przycisku bez wcześniejszej interakcji.
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
  // Klik = zaufana interakcja → dekoduj i dzwoń nawet przed reveal-em.
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
