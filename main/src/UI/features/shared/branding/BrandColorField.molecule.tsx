// UI/features/shared/branding/BrandColorField.molecule.tsx
// The ONE brand colour picker: the stylist's own profile and the salon
// profile choose the same thing, so they use the same control (round named
// swatches with a default). Curated palette from the kernel, a radiogroup, the chosen
// Saving stays with the caller (autosave on the profile, the form on salon).

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { BRAND_ACCENT_PALETTE } from '@kernel/domain/user-and-account/branding.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { LinkButtonAtom } from '../../../components/Button/LinkButton.atom';
import { handleRadioArrowNav } from '../../account/helpers/radioGroupArrowNav';
import { BrandThemePreviewMolecule } from './BrandThemePreview.molecule';
import styles from './BrandColorField.module.css';

interface BrandColorFieldProps {
  /** Used for the label's id; unique per screen. */
  id: string;
  label: string;
  /** Says where the colour lands on the public page. */
  hint: string;
  /** Chosen hex, or '' = the default (the app's own accent). */
  value: string;
  /** Plan gate (`can_brand_profile`); the hard gate lives in the backend. */
  canBrand: boolean;
  onSelect: (hex: string) => void;
  /** Optional save feedback right under the choice (autosave callers). */
  status?: ReactNode;
  onUpgrade?: () => void;
}

export function BrandColorFieldMolecule({
  id,
  label,
  hint,
  value,
  canBrand,
  onSelect,
  status,
  onUpgrade,
}: BrandColorFieldProps) {
  const t = useTranslations('account.profile');
  const chosen = BRAND_ACCENT_PALETTE.find(c => c.hex === value);
  const labelId = `${id}-label`;

  return (
    <div className={styles.branding} id={id}>
      <p className={styles.label} id={labelId}>
        {label}
      </p>
      <p className={styles.hint}>{hint}</p>
      {canBrand ? (
        <>
          <div
            className={styles.swatches}
            role='radiogroup'
            aria-labelledby={labelId}>
            <button
              type='button'
              role='radio'
              aria-checked={value === ''}
              tabIndex={value === '' ? 0 : -1}
              onKeyDown={handleRadioArrowNav}
              className={styles.swatchDefault}
              data-selected={value === '' || undefined}
              onClick={() => onSelect('')}>
              {/* The default is a colour too (the product accent): a dot shows
                  which one, or „Domyślny” read as „no colour”. */}
              <span className={styles.defaultDot} aria-hidden='true' />
              {t('brandingDefault')}
            </button>
            {BRAND_ACCENT_PALETTE.map(c => (
              <button
                key={c.id}
                type='button'
                role='radio'
                aria-checked={value === c.hex}
                tabIndex={value === c.hex ? 0 : -1}
                onKeyDown={handleRadioArrowNav}
                aria-label={t(`brandingColors.${c.id}`)}
                title={t(`brandingColors.${c.id}`)}
                className={styles.swatch}
                data-selected={value === c.hex || undefined}
                style={{ background: c.hex }}
                onClick={() => onSelect(c.hex)}
              />
            ))}
          </div>
          {/* The swatches carry no text, so the choice is said in words. */}
          <p className={styles.chosen} aria-live='polite'>
            {t('brandingChosen', {
              name: chosen
                ? t(`brandingColors.${chosen.id}`)
                : t('brandingDefault'),
            })}
          </p>
          {/* A picture of what the colour does on the public page, not a
              control: readers asked where the chosen colour goes and
              whether it worked. Inert, caption above. */}
          <BrandThemePreviewMolecule value={value} />
          {status}
        </>
      ) : (
        // DECISION: the plan-locked state is one sentence and one action. A row of dimmed palette
        // dots read as broken swatches, not as a preview of the feature.
        <div className={styles.locked}>
          <p className={styles.hint}>{t('brandingLockedNote')}</p>
          <LinkButtonAtom
            href={ROUTES_FRONT.USER_ACCOUNT_PAY}
            variant='outlined'
            size='sm'
            onClick={onUpgrade}>
            {t('brandingUpgradeCta')}
          </LinkButtonAtom>
        </div>
      )}
    </div>
  );
}
