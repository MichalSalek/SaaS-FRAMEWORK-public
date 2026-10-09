import Image from 'next/image';
import { useTranslations } from 'next-intl';
import styles from './PhoneMockup.module.css';

export interface PhoneMockupProps {
  label: string;
  route: string;
  state?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'xxl' | 'hero';
  className?: string;
  /** Real app screenshot src (capture z /app/* przez scripts/qa-screenshot.cjs,
   *  drop do main/public/img/lp/). Gdy brak — renderuje honest placeholder
   *  (schematyczny podglad), nie pusty/zepsuty ekran. Wstawienie = swap danych. */
  screenshot?: string;
}

/**
 * PhoneMockup — placeholder for a product screenshot.
 *
 * `label` describes the exact screen/state to capture.
 * `route`  is the app route shown as metadata.
 * `state`  is optional context (e.g. "stylistka, 12 zdjęć").
 */
/* DECISION (głos ownera S24, nie usuwaj): figcaption USUNIĘTY z komponentu —
 * podpisy pod screenami („Twój panel właścicielki… /app/pairing") to robocze
 * dev-adnotacje, owner kazał je wywalić WSZĘDZIE. Opis ekranu żyje wyłącznie
 * w aria-label; wrapper trzyma wymiar przez ramę (lekcja S21a). NIE przywracać
 * widocznych podpisów bez głosu ownera. */
export function PhoneMockupMolecule({
  label,
  route,
  state,
  size = 'md',
  className,
  screenshot,
}: PhoneMockupProps) {
  const t = useTranslations('phoneMockup');
  const fullCaption = state ? `${label}: ${state}` : label;
  // Sizes hint ≈ rendered frame width (next/image picks srcset ≥ this × DPR;
  // bigger frames need a bigger hint, inaczej retina = pikseloza). Zob.
  // PhoneMockup.module.css size variants.
  const sizesHint: Record<NonNullable<PhoneMockupProps['size']>, string> = {
    sm: '180px',
    md: '220px',
    lg: '300px',
    xl: '360px',
    xxl: '420px',
    hero: '480px',
  };

  return (
    <figure
      className={`${styles.wrapper} ${styles[size]} ${className ?? ''}`}
      data-no-caption=''
      aria-label={t('ariaLabel', { caption: fullCaption })}>
      <div className={styles.frame} aria-hidden='true'>
        {screenshot ? (
          <Image
            className={styles.screenshotImg}
            src={screenshot}
            alt=''
            fill
            sizes={sizesHint[size]}
            style={{ objectFit: 'cover' }}
          />
        ) : (
          <div className={styles.screen}>
            {/* Honest placeholder: schematyczny podglad dopoki realny screenshot
                nie jest podpiety (prop `screenshot`). */}
            <div className={styles.screenGrid}>
              <div className={styles.screenTile} />
              <div className={styles.screenTile} />
              <div className={styles.screenTile} />
              <div className={styles.screenTile} />
              <div className={styles.screenTile} />
            </div>
            <span className={styles.routePill}>{route}</span>
          </div>
        )}
      </div>
    </figure>
  );
}
