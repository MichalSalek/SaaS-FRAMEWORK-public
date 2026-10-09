import { useEffect } from 'react';
import { CheckCircleIcon, HandshakeIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { AppModalShellAtom } from '../../../primitives/AppModalShell.atom';
import { hapticNotification } from '../../../../application/platform/haptics';
import styles from './FirstPhotoCelebration.module.css';

interface FirstPhotoCelebrationProps {
  onGoToPairing: () => void;
  onAddAnother: () => void;
  onGoToGallery: () => void;
}

export function FirstPhotoCelebrationOrganism({
  onGoToPairing,
  onAddAnother,
  onGoToGallery,
}: FirstPhotoCelebrationProps) {
  const t = useTranslations('pages.gallery');
  useEffect(() => {
    void hapticNotification('Success');
  }, []);
  // Pełnoekranowe przejęcie (focus-trap + aria-modal + tło inert w AppModalShell).
  // Brak onClose: 3 akcje to wyjścia naprzód (brak „zamknij"). Caller renderuje to
  // tylko na kroku celebracji → active domyślnie true.
  return (
    <AppModalShellAtom
      variant='fullscreen'
      role='dialog'
      labelledById='first-photo-celebration-title'
      className={styles.overlay}>
      <div className={styles.confettiContainer} aria-hidden='true'>
        {Array.from({ length: 30 }, (_, i) => (
          <div
            key={i}
            className={styles.confettiPiece}
            style={
              {
                '--delay': `${i * 0.05}s`,
                '--x': `${Math.random() * 100}%`,
                '--hue': `${Math.random() * 360}`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <div className={styles.content}>
        <div className={styles.iconPop}>
          <CheckCircleIcon size={48} color='var(--color-success)' />
        </div>
        <TypographyAtom
          id='first-photo-celebration-title'
          variant='h3'
          align='center'>
          {t('celebrationTitle')}
        </TypographyAtom>
        <TypographyAtom variant='body2' align='center'>
          {t('celebrationHint')}
        </TypographyAtom>
        <div className={styles.actions}>
          <ButtonAtom
            variant='primary'
            size='lg'
            icon={<HandshakeIcon size={18} weight='fill' />}
            onClick={onGoToPairing}
            className='haptic-press'>
            {t('celebrationGoToPairing')}
          </ButtonAtom>
          <ButtonAtom
            variant='outlined'
            size='md'
            onClick={onAddAnother}
            className='haptic-press'>
            {t('uploadAddAnother')}
          </ButtonAtom>
          <ButtonAtom
            variant='text'
            size='md'
            onClick={onGoToGallery}
            className='haptic-press'>
            {t('celebrationGoToGallery')}
          </ButtonAtom>
        </div>
      </div>
    </AppModalShellAtom>
  );
}
