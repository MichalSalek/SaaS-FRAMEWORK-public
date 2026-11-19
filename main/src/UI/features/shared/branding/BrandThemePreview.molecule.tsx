import { MapPinIcon, PhoneCallIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { AffordanceDiscAtom } from '../../../components/AffordanceDisc/AffordanceDisc.atom';
import { brandScopeProps } from './brandScope';
import styles from './BrandColorField.module.css';

/** Live miniature of the public profile. Inert: it shows the chosen theme. */
export function BrandThemePreviewMolecule({ value }: { value: string }) {
  const t = useTranslations('account.profile');
  return (
    <div className={styles.preview} aria-hidden='true'>
      <span className={styles.previewCaption}>{t('brandingPreview')}</span>
      <span {...brandScopeProps(value || null, styles.previewCard)}>
        <span className={styles.previewIdentity}>
          <span className={styles.previewAvatar} />
          <span className={styles.previewCopy}>
            <span className={styles.previewName}>
              {t('brandingPreviewName')}
            </span>
            <span className={styles.previewPlace}>
              <span className={styles.previewPlaceIcon}>
                <MapPinIcon size={16} weight='fill' />
              </span>
              <span>{t('brandingPreviewPlace')}</span>
            </span>
          </span>
        </span>
        <span className={styles.previewContact}>
          <PhoneCallIcon size={16} />
          <span>{t('brandingPreviewContact')}</span>
          <AffordanceDiscAtom />
        </span>
        <span className={styles.previewButton}>
          {t('brandingPreviewButton')}
        </span>
      </span>
    </div>
  );
}
