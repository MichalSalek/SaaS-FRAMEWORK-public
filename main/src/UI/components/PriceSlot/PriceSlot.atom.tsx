import styles from './PriceSlot.module.css';

interface PriceSlotProps {
  value: number | null;
  isLoading: boolean;
  suffix?: string;
  size?: 'sm' | 'md' | 'lg';
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

const formatMinorUnits = (amount: number): string =>
  Math.round(amount / 100).toString();

export function PriceSlotAtom({
  value,
  isLoading,
  suffix,
  size = 'md',
}: PriceSlotProps) {
  const displayDigits =
    value === null || value === undefined
      ? null
      : formatMinorUnits(value).split('');

  if (value === 0 && !isLoading) {
    return (
      <span className={`${styles.wrapper} ${styles[size]} ${styles.fadeIn}`}>
        0{suffix ? <span className={styles.suffix}>{suffix}</span> : null}
      </span>
    );
  }

  /* DECISION (pricing.policy.ts ~236, nie usuwaj): brak ceny ze Stripe =
   * skeleton-roll, NIGDY tekst zastępczy. Wcześniejszy branch renderował tu
   * „Indywidualnie" po wyczerpaniu retry — fałsz na planach Free/Pro
   * („Free Indywidualnie PLN"). Plan kontaktowy (Scale) ma własną ścieżkę
   * isContact NA stronach, zanim PriceSlot w ogóle powstanie. */
  const showSkeleton = isLoading || displayDigits === null;
  const digits = showSkeleton ? ['0', '0'] : displayDigits;

  return (
    <span
      className={`${styles.wrapper} ${styles[size]} ${showSkeleton ? styles.loading : styles.fadeIn}`}>
      {/* Tor odometru czyta się literalnie jako "0123456789" per cyfra —
          aria-hidden + sr-only z realną wartością (po osiedleniu). */}
      {!showSkeleton && displayDigits !== null && (
        <span className='sr-only'>{displayDigits.join('')}</span>
      )}
      {digits.map((d, i) => (
        <span
          key={i}
          aria-hidden='true'
          className={styles.digit}
          style={
            !showSkeleton
              ? ({
                  '--digit': d,
                  transitionDelay: `${i * 80}ms`,
                } as React.CSSProperties)
              : undefined
          }>
          <span className={styles.digitTrack}>
            {DIGITS.map(n => (
              <span key={n}>{n}</span>
            ))}
            {/* Klon "0" domyka pętlę skeletona: keyframe scroll kończy na
                -10lh, gdzie bez klona okno jest puste (mrugnięcie co cykl).
                Po osiedleniu max offset to -9lh — klon nigdy nie widoczny. */}
            <span>0</span>
          </span>
        </span>
      ))}
      {suffix ? <span className={styles.suffix}>{suffix}</span> : null}
    </span>
  );
}
