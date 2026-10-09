// UI/features/gallery/components/MarketingCatchOverlay.organism.tsx
// Pełnoekranowy „łap zgodę marketingową" pokazywany RAZ po pierwszym zdjęciu
// stylistce, która pominęła opt-in w onboardingu (eligibility + mutacja w
// useMarketingCatch). Czysto prezentacyjny — akcje (optIn/dismiss) wstrzykuje
// caller (UploadAssetPage), który po rozwiązaniu wykonuje pierwotną nawigację
// z celebracji.
//
// Floor 7×ZERO (flat): solidne tło (bg-main), ikona w pigułce na bg-paper +
// hairline, zero gradientu/cienia/glow/jednostronnych borderów/hover-na-statycznym.
// Pełnoekranowy język spójny z FirstPhotoCelebration (.overlay), bez konfetti.
//
// Stack: next-intl + CSS Modules + Phosphor Icons.

import { MegaphoneSimpleIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { AppModalShellAtom } from '../../../primitives/AppModalShell.atom';
import styles from './MarketingCatchOverlay.module.css';

interface MarketingCatchOverlayProps {
  isPending: boolean;
  onOptIn: () => void;
  onDismiss: () => void;
}

export function MarketingCatchOverlayOrganism({
  isPending,
  onOptIn,
  onDismiss,
}: MarketingCatchOverlayProps) {
  const t = useTranslations('pages.gallery');

  // Focus-trap + aria-modal + tło inert: w AppModalShell. Caller (UploadAssetPage)
  // renderuje to tylko gdy catchOpen → active domyślnie true. ESC = dismiss.
  return (
    <AppModalShellAtom
      variant='fullscreen'
      role='dialog'
      labelledById='marketing-catch-title'
      onClose={onDismiss}
      className={styles.overlay}>
      <div className={styles.content}>
        <span className={styles.iconWrap} aria-hidden='true'>
          <MegaphoneSimpleIcon size={26} weight='duotone' />
        </span>
        <TypographyAtom id='marketing-catch-title' variant='h3' align='center'>
          {t('marketingCatchTitle')}
        </TypographyAtom>
        <TypographyAtom variant='body2' align='center' className={styles.body}>
          {t('marketingCatchBody')}
        </TypographyAtom>
        <div className={styles.actions}>
          <ButtonAtom
            variant='primary'
            size='lg'
            onClick={onOptIn}
            loading={isPending}
            className='haptic-press'>
            {t('marketingCatchOptIn')}
          </ButtonAtom>
          <ButtonAtom
            variant='text'
            size='md'
            onClick={onDismiss}
            disabled={isPending}
            className='haptic-press'>
            {t('marketingCatchDismiss')}
          </ButtonAtom>
        </div>
      </div>
    </AppModalShellAtom>
  );
}
