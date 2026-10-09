import { TypographyAtom } from '../Typography/Typography.atom';
import { ButtonAtom } from '../Button/Button.atom';
import styles from './StickyCtaBar.module.css';

interface StickyCtaBarProps {
  visible: boolean;
  text: string;
  buttonText: string;
  onButtonClick: () => void;
  /** Button size — defaults to "sm" */
  buttonSize?: 'sm' | 'md';
  /** Typography variant for the text — defaults to "body2" */
  textVariant?: 'body2' | 'caption';
}

export function StickyCtaBarMolecule({
  visible,
  text,
  buttonText,
  onButtonClick,
  buttonSize = 'sm',
  textVariant = 'body2',
}: StickyCtaBarProps) {
  return (
    /* data-sticky-cta: hook dla PublicLayout — stopka stron z barem dostaje
     * dodatkowy padding-bottom (bar pływa nad nią i zasłaniał copyright). */
    /* inert gdy schowany: pasek jest wtedy tylko przesunięty i przezroczysty,
     * więc Tab wchodził w niewidoczny przycisk, a czytnik czytał go dwa razy
     * (obok CTA w treści strony). */
    <div
      className={styles.stickyCtaBar}
      data-sticky-cta=''
      data-visible={visible || undefined}
      inert={!visible}>
      <TypographyAtom variant={textVariant} className={styles.stickyCtaText}>
        {text}
      </TypographyAtom>
      {/* data-cta-shimmer='on': sweep na primary CTA (global.css); wrapper display:contents zachowuje flex. */}
      <span className={styles.shimmerWrap} data-cta-shimmer='on'>
        <ButtonAtom
          direction='forward'
          variant='primary'
          size={buttonSize}
          onClick={onButtonClick}>
          {buttonText}
        </ButtonAtom>
      </span>
    </div>
  );
}
