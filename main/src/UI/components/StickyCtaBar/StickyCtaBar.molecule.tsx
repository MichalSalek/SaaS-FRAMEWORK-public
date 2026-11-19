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
    /* data-sticky-cta: hook for PublicLayout; the footer of a page with the bar
     * gets extra padding-bottom (the bar floats over it and would cover the copyright). */
    /* inert while hidden: the bar is then only translated and transparent, so
     * Tab would land on an invisible button and a screen reader would read it
     * twice (beside the in-page CTA). */
    <div
      className={styles.stickyCtaBar}
      data-sticky-cta=''
      data-visible={visible || undefined}
      inert={!visible}>
      <TypographyAtom variant={textVariant} className={styles.stickyCtaText}>
        {text}
      </TypographyAtom>
      {/* data-cta-shimmer='on': sweep on the primary CTA (global.css); the display:contents wrapper keeps the flex. */}
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
