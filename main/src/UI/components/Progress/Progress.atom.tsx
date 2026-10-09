import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import styles from './Progress.module.css';

type ProgressVariant = 'linear' | 'spinner';
type ProgressSize = 'sm' | 'md' | 'lg';

export interface ProgressProps {
  variant?: ProgressVariant;
  /** 0-100 for determinate mode. Omit for indeterminate. */
  value?: number;
  size?: ProgressSize;
  className?: string;
  /**
   * Nadpisanie dostępnej nazwy, gdy pasek opisuje coś konkretniejszego niż
   * samo ładowanie (np. postęp wysyłki zdjęcia). Domyślna nazwa jest
   * TŁUMACZONA — nie podawaj tu literału.
   */
  ariaLabel?: string;
}

const SPINNER_PX: Record<ProgressSize, number> = {
  sm: 16,
  md: 24,
  lg: 32,
};

const STROKE_WIDTH: Record<ProgressSize, number> = {
  sm: 2.5,
  md: 3,
  lg: 3.5,
};

export function ProgressAtom({
  variant = 'linear',
  value,
  size = 'md',
  className,
  ariaLabel,
}: ProgressProps) {
  const tA11y = useTranslations('a11y');
  // Domyślna nazwa szła jako angielski literał 'Loading', a większość wywołań
  // nie podaje własnej — czytnik ogłaszał ją po angielsku w polskim i niemieckim
  // interfejsie (nieskończony scroll galerii, postęp wysyłki).
  const resolvedAriaLabel = ariaLabel ?? tA11y('loading');

  if (variant === 'spinner') {
    return (
      <Spinner
        size={size}
        className={className}
        ariaLabel={resolvedAriaLabel}
      />
    );
  }

  const isDeterminate = value !== undefined;
  const clampedValue = isDeterminate ? Math.max(0, Math.min(100, value)) : 0;

  return (
    <div
      className={clsx(styles.linearTrack, styles[`linear-${size}`], className)}
      role='progressbar'
      aria-label={resolvedAriaLabel}
      aria-valuenow={isDeterminate ? clampedValue : undefined}
      aria-valuemin={0}
      aria-valuemax={100}>
      <div
        className={clsx(
          styles.linearBar,
          isDeterminate ? styles.determinate : styles.indeterminate
        )}
        style={isDeterminate ? { width: `${clampedValue}%` } : undefined}
      />
    </div>
  );
}

function Spinner({
  size,
  className,
  ariaLabel,
}: {
  size: ProgressSize;
  className?: string | undefined;
  ariaLabel: string;
}) {
  const px = SPINNER_PX[size];
  const sw = STROKE_WIDTH[size];
  const radius = (px - sw) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg
      className={clsx(styles.spinner, className)}
      width={px}
      height={px}
      viewBox={`0 0 ${px} ${px}`}
      role='progressbar'
      aria-label={ariaLabel}>
      {/* Background track */}
      <circle
        className={styles.spinnerTrack}
        cx={px / 2}
        cy={px / 2}
        r={radius}
        fill='none'
        strokeWidth={sw}
      />
      {/* Animated arc */}
      <circle
        className={styles.spinnerArc}
        cx={px / 2}
        cy={px / 2}
        r={radius}
        fill='none'
        strokeWidth={sw}
        strokeLinecap='round'
        strokeDasharray={circumference}
        strokeDashoffset={circumference * 0.75}
      />
    </svg>
  );
}
