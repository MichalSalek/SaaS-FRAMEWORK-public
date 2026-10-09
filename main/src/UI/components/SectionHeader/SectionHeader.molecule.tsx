import type { ReactNode } from 'react';
import clsx from 'clsx';
import { EyebrowAtom, type EyebrowVariant } from '../Eyebrow/Eyebrow.atom';
import styles from './SectionHeader.module.css';

type SectionHeaderAlign = 'start' | 'center';

export interface SectionHeaderProps {
  eyebrow?: ReactNode;
  eyebrowVariant?: EyebrowVariant;
  title?: ReactNode;
  /** id for the <h2>, so a section can wire aria-labelledby to it. */
  titleId?: string;
  align?: SectionHeaderAlign;
  className?: string;
  /** Lede / supporting copy rendered under the title. */
  children?: ReactNode;
}

/**
 * Canonical section header — Eyebrow + headline <h2> + optional lede, in a
 * consistent vertical stack. Replaces the duplicated .sectionEyebrow +
 * .sectionHeadline pairs across section files.
 *
 * Per-strona dostrojenie nagłówka → var-hooki na `className` (S37): skala
 * (--section-headline-size / -leading / -tracking / -measure), KOLOR nagłówka
 * (--section-headline-color, np. on-ink), hyphenacja (--section-headline-hyphens,
 * np. auto dla wąskich PL nagłówków), kolor lede (--section-lede-color) i kolor
 * kickera (--eyebrow-color, dziedziczony przez Eyebrow). Patrz
 * SectionHeader.module.css. Strony recolorujące kicker (accent / on-ink) lub
 * z lokalną typografią (hyphens) migrują przez te hooki — NIE hand-roll
 * (wcześniejsze wyjątki About/Compare/HelpCenter z FDX W5.1 wchłonięte w S37,
 * gdy kanon dostał hooki koloru/hyphens). Split-keyword headline → przekaż
 * `title` jako ReactNode (`<>{lead}<span>{kw}</span>{trail}</>`).
 */
export function SectionHeaderMolecule({
  eyebrow,
  eyebrowVariant = 'plain',
  title,
  titleId,
  align = 'start',
  className,
  children,
}: SectionHeaderProps) {
  return (
    <div className={clsx(styles.header, styles[align], className)}>
      {eyebrow != null && (
        <EyebrowAtom variant={eyebrowVariant}>{eyebrow}</EyebrowAtom>
      )}
      {title != null && (
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
      )}
      {children != null && <div className={styles.lede}>{children}</div>}
    </div>
  );
}
