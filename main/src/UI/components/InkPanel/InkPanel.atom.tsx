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
 * DECISION: a closed rectangle is the canon: a negative is ALWAYS a closed rectangle with a
 * radius and margin on a light background, NEVER a full-bleed band ("too heavy"). Do NOT add a
 * full-bleed variant. The interior (grid/flex) is the page's business: the panel gives only the
 * field, the frame and the text color. (owner)
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
      data-app-section-exclude=''
      aria-labelledby={ariaLabelledby}>
      {children}
    </Tag>
  );
}
