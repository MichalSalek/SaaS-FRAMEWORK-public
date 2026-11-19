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
   * chips — outlined pills with a hairline frame (about / for-clients canon).
   * grid  — an even grid of static cards with a full hairline border.
   */
  variant?: TrustSignalsVariant;
  className?: string;
  ariaLabel?: string;
}

/**
 * TrustSignals — canonical trust pills / trust signals (no per-page `.trustList`).
 * Members are separated by the icon and a gap (no middle dot, owner); pages pass
 * only the items (i18n). Cards/pills are STATIC (non-interactive): no hover (floor §4).
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
