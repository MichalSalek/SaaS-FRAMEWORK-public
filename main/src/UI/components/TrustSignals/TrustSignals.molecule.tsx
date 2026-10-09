import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './TrustSignals.module.css';

interface TrustItem {
  /** Decorative icon (Phosphor) — rendered aria-hidden, gold tint. */
  icon?: ReactNode;
  text: ReactNode;
}

type TrustSignalsVariant = 'pills' | 'chips' | 'grid';

export interface TrustSignalsProps {
  items: ReadonlyArray<TrustItem>;
  /**
   * pills — inline chip row, items separated by their icon and a gap (kanon for-stylists /
   *         get-app / home `.trustList`).
   * chips — obrzeżone pigułki z hairline ramą (kanon about / for-clients,
   *         S24 — wcześniej kopiowane per-page).
   * grid  — równa siatka statycznych kart z pełnym hairline borderem.
   */
  variant?: TrustSignalsVariant;
  className?: string;
  ariaLabel?: string;
}

/**
 * TrustSignals — kanoniczne trust-pille / sygnały zaufania (dotąd kopiowane
 * per-page na 7 stronach jako `.trustList`). Człony rozdziela ikona i odstęp (bez kropki środkowej, owner 2026-10-08);
 * strony przekazują wyłącznie itemy (i18n).
 * Karty/pille są STATYCZNE (nieinteraktywne) — zero hover (floor §4).
 */
export function TrustSignalsMolecule({
  items,
  variant = 'pills',
  className,
  ariaLabel,
}: TrustSignalsProps) {
  return (
    <ul
      className={clsx(styles.list, styles[variant], className)}
      aria-label={ariaLabel}>
      {items.map((item, idx) => (
        <li key={idx} className={styles.item}>
          {item.icon != null && (
            <span className={styles.icon} aria-hidden='true'>
              {item.icon}
            </span>
          )}
          <span className={styles.text}>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}
