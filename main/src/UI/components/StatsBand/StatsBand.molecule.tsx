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
 * DECISION (nie usuwaj tego komentarza):
 * ink-card = ZAMKNIĘTY prostokąt (taste 14 / głos ownera S21 „2C") —
 * ciemny panel --color-ink/--color-on-ink z radiusem, osadzony na jasnym
 * tle w kontenerze rodzica. NIE dodawać wariantu full-bleed ink-banda —
 * pełnoszerokościowy negatyw przegrał głosowanie z zamkniętą figurą.
 * Komponent celowo NIE robi własnej sekcji 100vw — siedzi w kontenerze
 * strony (Style Policy §4).
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
