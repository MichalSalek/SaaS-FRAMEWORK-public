import clsx from 'clsx';
import styles from './NumberMarker.module.css';

type NumberMarkerSize = 'sm' | 'lg';

export interface NumberMarkerProps {
  value: number | string;
  size?: NumberMarkerSize;
  className?: string;
}

/**
 * Canonical decorative numeral — large Marcellus figure in gold, used as a
 * step / benefit / pain-point counter. Numbers are zero-padded to two digits.
 * Decorative only (aria-hidden) — the surrounding heading carries the meaning.
 * Replaces .stepNumeral / .benefitNumeral / .painNumeral.
 */
export function NumberMarkerAtom({
  value,
  size = 'lg',
  className,
}: NumberMarkerProps) {
  const display =
    typeof value === 'number' ? String(value).padStart(2, '0') : value;

  return (
    <span
      className={clsx(styles.marker, styles[size], className)}
      aria-hidden='true'>
      {display}
    </span>
  );
}
