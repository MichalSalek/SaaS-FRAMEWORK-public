import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './InkPanel.module.css';

type InkPanelTone = 'ink' | 'violet';
type InkPanelElement = 'div' | 'section' | 'aside';

export interface InkPanelProps {
  /**
   * ink    — negatyw --color-ink / --color-on-ink (mode-invariant);
   * violet — wzorzec fioletowej karty (--color-secondary, AA-pogłębiony
   *          w light mode — patrz CSS).
   */
  tone?: InkPanelTone;
  /** Szerokość = kontenera rodzica; panel NIE robi własnego full-bleed. */
  children: ReactNode;
  className?: string;
  as?: InkPanelElement;
  ariaLabelledby?: string;
}

/**
 * InkPanel — zamknięty ciemny prostokąt na jasnym tle.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Zamknięty prostokąt = kanon (taste 14, głos ownera S20): negatyw to ZAWSZE
 * zamknięty prostokąt z radiusem i marginesem na jasnym tle, NIGDY full-bleed
 * pas ("zbyt ciężki"). NIE dodawać wariantu full-bleed. Wnętrze (grid/flex)
 * to sprawa strony — panel daje tylko pole, ramę i kolor tekstu.
 */
export function InkPanelAtom({
  tone = 'ink',
  children,
  className,
  as: Tag = 'div',
  ariaLabelledby,
}: InkPanelProps) {
  return (
    <Tag
      className={clsx(styles.panel, styles[tone], className)}
      aria-labelledby={ariaLabelledby}>
      {children}
    </Tag>
  );
}
