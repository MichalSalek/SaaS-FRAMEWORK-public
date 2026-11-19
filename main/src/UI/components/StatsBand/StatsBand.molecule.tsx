import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './StatsBand.module.css';

export interface StatItem {
  /** Liczba-dowód — semantyczny tekst (<strong>), NIE aria-hidden. */
  figure: ReactNode;
  label: ReactNode;
  footnote?: ReactNode;
}

type StatsBandVariant = 'ink-card' | 'plain-row';

export interface StatsBandProps {
  items: ReadonlyArray<StatItem>;
  /**
   * ink-card  — kanon: zamknięta ink-karta liczb (ciemny panel z radiusem
   *             na jasnym tle).
   * plain-row — cichy rząd liczb bez panelu (kanon about `.statsList`).
   */
  variant?: StatsBandVariant;
  /** Opcjonalny nagłówek WEWNĄTRZ panelu (h2). */
  heading?: ReactNode;
  /** id nagłówka — rodzic może spiąć `aria-labelledby` swojej sekcji. */
  headingId?: string;
  className?: string;
}

const VARIANT_CLASS: Record<StatsBandVariant, string> = {
  'ink-card': styles.inkCard ?? '',
  'plain-row': styles.plainRow ?? '',
};

/**
 * StatsBand — kanoniczna sekcja liczb-dowodów.
 *
 * DECISION: ink-card = a CLOSED rectangle (owner vote): a dark --color-ink/--color-on-ink panel
 * with a radius, set on a light background in the parent's container. Do NOT add a full-bleed ink
 * band variant: a full-width negative lost the vote against the closed figure. The component
 * deliberately makes no 100vw section of its own; it sits in the page's container (Style Policy §4).
 */
export function StatsBandMolecule({
  items,
  variant = 'ink-card',
  heading,
  headingId,
  className,
}: StatsBandProps) {
  return (
    <div className={clsx(styles.band, VARIANT_CLASS[variant], className)}>
      {heading != null && (
        <h2 id={headingId} className={styles.heading}>
          {heading}
        </h2>
      )}
      <ul className={styles.list}>
        {items.map((item, idx) => (
          <li key={idx} className={styles.item}>
            <strong className={styles.figure}>{item.figure}</strong>
            <span className={styles.label}>{item.label}</span>
            {item.footnote != null && (
              <span className={styles.footnote}>{item.footnote}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
