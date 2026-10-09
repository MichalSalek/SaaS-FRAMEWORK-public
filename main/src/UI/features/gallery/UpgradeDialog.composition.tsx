import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import posthog from 'posthog-js';
import { TrendUpIcon } from '@phosphor-icons/react';
import {
  getPlanDisplayName,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { AppModalShellAtom } from '../../primitives/AppModalShell.atom';
import styles from './GalleryPage.module.css';

interface UpgradeDialogProps {
  currentPlan: PricingPlan;
  maxPhotos: number;
  onClose: () => void;
  onUpgrade: () => void;
}

export function UpgradeDialogComposition({
  currentPlan,
  maxPhotos,
  onClose,
  onUpgrade,
}: UpgradeDialogProps) {
  const t = useTranslations('pages.gallery');

  // Parent renderuje dialog tylko gdy otwarty → mount == pokazanie promptu.
  // trigger='gallery_limit' (jedyny wywoływacz — limit zdjęć w galerii).
  // posthog singleton respektuje opt-out wewnętrznie.
  useEffect(() => {
    posthog.capture('upgrade_prompt_shown', {
      trigger: 'gallery_limit',
      current_plan: currentPlan,
    });
  }, [currentPlan]);

  // Backdrop (scrim) + panel + focus-trap + aria-modal: w AppModalShell
  // (variant='backdrop'). Klik-poza-panel zamyka (scrim role='presentation',
  // target-check — bez stopPropagation); ESC zamyka przez focus-trap. Parent
  // renderuje to tylko gdy otwarty → active domyślnie true.
  return (
    <AppModalShellAtom
      variant='backdrop'
      role='dialog'
      label={t('upgradeDialogLabel')}
      onClose={onClose}
      backdropClassName={styles.dialogBackdrop}
      className={styles.dialogPanel}>
      <div className={styles.dialogIcon}>
        <TrendUpIcon size={32} />
      </div>
      <TypographyAtom variant='h4' align='center'>
        {t('upgradeTitle')}
      </TypographyAtom>
      <TypographyAtom variant='body2' align='center'>
        {t('upgradeBody', {
          plan: getPlanDisplayName(currentPlan),
          max: maxPhotos,
        })}
      </TypographyAtom>
      <ButtonAtom
        variant='primary'
        size='lg'
        icon={<TrendUpIcon size={18} />}
        onClick={onUpgrade}
        className={styles.dialogCta}>
        {t('upgradeCta')}
      </ButtonAtom>
      <ButtonAtom variant='text' size='sm' onClick={onClose}>
        {t('upgradeNotNow')}
      </ButtonAtom>
    </AppModalShellAtom>
  );
}
