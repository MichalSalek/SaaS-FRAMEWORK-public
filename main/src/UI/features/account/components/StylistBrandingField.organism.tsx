// UI/features/account/components/StylistBrandingField.organism.tsx
// Kolor marki na publicznym profilu: kuratorowana paleta (radiogroup) plus
// stan zablokowany planem. Wyniesione ze `StylistProfileSection` 2026-09-09,
// gdy sekcja przekroczyła limit modularności — logika zapisu (single-flight
// per sekcja API) zostaje u rodzica, tutaj jest sam wybór.

import { useTranslations } from 'next-intl';
import { BRAND_ACCENT_PALETTE } from '@kernel/domain/user-and-account/branding.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { LinkButtonAtom } from '../../../components/Button/LinkButton.atom';
import { handleRadioArrowNav } from '../helpers/radioGroupArrowNav';
import styles from './StylistProfileSection.module.css';

interface StylistBrandingFieldProps {
  /** Wybrany hex albo '' = kolor domyślny (ton policzony z nazwy). */
  accentColor: string;
  /** Gate planu (`can_brand_profile`) — twardy gate żyje na backendzie. */
  canBrand: boolean;
  onSelect: (hex: string) => void;
}

export function StylistBrandingFieldOrganism({
  accentColor,
  canBrand,
  onSelect,
}: StylistBrandingFieldProps) {
  const t = useTranslations('account.profile');

  return (
    <div className={styles.branding}>
      <p className={styles.brandingLabel} id='brand-colour-label'>
        {t('brandingLabel')}
      </p>
      {/* Skąd bierze się kolor, którego nikt nie wybrał: profil bez ustawionej
          barwy dostaje ton policzony z nazwy (coverHueVars), więc każda
          stylistka ma inny, ale swój własny. Bez tego zdania „Domyślny"
          wygląda jak losowy róż przypisany wszystkim (pytanie ownera
          2026-09-09). */}
      <p className={styles.hint}>{t('brandingDefaultHint')}</p>
      {canBrand ? (
        <div
          className={styles.swatches}
          role='radiogroup'
          aria-labelledby='brand-colour-label'>
          <button
            type='button'
            role='radio'
            aria-checked={accentColor === ''}
            tabIndex={accentColor === '' ? 0 : -1}
            onKeyDown={handleRadioArrowNav}
            className={styles.swatchDefault}
            data-selected={accentColor === '' || undefined}
            onClick={() => onSelect('')}>
            {t('brandingDefault')}
          </button>
          {BRAND_ACCENT_PALETTE.map(c => (
            <button
              key={c.id}
              type='button'
              role='radio'
              aria-checked={accentColor === c.hex}
              tabIndex={accentColor === c.hex ? 0 : -1}
              onKeyDown={handleRadioArrowNav}
              aria-label={t(`brandingColors.${c.id}`)}
              title={t(`brandingColors.${c.id}`)}
              className={styles.swatch}
              data-selected={accentColor === c.hex || undefined}
              style={{ background: c.hex }}
              onClick={() => onSelect(c.hex)}
            />
          ))}
        </div>
      ) : (
        // DECISION (nie usuwaj tego komentarza) — census S126, 2026-10-08:
        // stan zablokowany planem to zdanie i jedna akcja. Stał tu rząd
        // przygaszonych kropek palety (opacity 0.45), który czytał się jak
        // zepsute próbki, a nie jak zapowiedź funkcji.
        <div className={styles.locked}>
          <p className={styles.hint}>{t('brandingLockedNote')}</p>
          <LinkButtonAtom
            href={ROUTES_FRONT.USER_ACCOUNT_PAY}
            variant='outlined'
            size='sm'>
            {t('brandingUpgradeCta')}
          </LinkButtonAtom>
        </div>
      )}
    </div>
  );
}
