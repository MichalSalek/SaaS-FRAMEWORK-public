import styles from './PriceSlot.module.css';
import { formatMinorAmount } from '@kernel/domain/pricing/money.format';
import type { BillingCurrency } from '@kernel/domain/localization/country.config';

interface PriceSlotProps {
  value: number | null;
  isLoading: boolean;
  suffix?: string;
  size?: 'sm' | 'md' | 'lg';
  currency?: BillingCurrency;
  locale?: string;
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function PriceSlotAtom({
  value,
  isLoading,
  suffix,
  size = 'md',
  locale = 'pl',
}: PriceSlotProps) {
  const displayDigits =
    value === null || value === undefined
      ? null
      : formatMinorAmount(value, locale).split('');

  if (value === 0 && !isLoading) {
    return (
      <span className={`${styles.wrapper} ${styles[size]} ${styles.fadeIn}`}>
        0{suffix ? <span className={styles.suffix}>{suffix}</span> : null}
      </span>
    );
  }

  /* DECISION: no price from Stripe = skeleton-roll, NEVER a fallback text (see the zero-prices
   * decision in .shared-kernel/policies/pricing.policy.ts). A fallback "Indywidualnie" after retry
   * exhaustion was a lie on Free/Pro ("Free Indywidualnie PLN"). The contact plan (Scale) has its
   * own isContact path on the pages, before PriceSlot exists. */
  const showSkeleton = isLoading || displayDigits === null;
  const digits = showSkeleton ? ['0', '0'] : displayDigits;

  return (
    <span
      className={`${styles.wrapper} ${styles[size]} ${showSkeleton ? styles.loading : styles.fadeIn}`}>
      {/* The odometer track reads literally as "0123456789" per digit, so it is
          aria-hidden plus sr-only text with the real value (once settled). */}
      {!showSkeleton && displayDigits !== null && (
        <span className='sr-only'>{displayDigits.join('')}</span>
      )}
      {digits.map((d, i) =>
        !/^\d$/.test(d) ? (
          <span key={i} aria-hidden='true'>
            {d}
          </span>
        ) : (
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
              {/* The clone "0" closes the skeleton loop: the scroll keyframe ends at
                -10lh, where without the clone the window is empty (a blink per
                cycle). Once settled the max offset is -9lh, so the clone never shows. */}
              <span>0</span>
            </span>
          </span>
        )
      )}
      {suffix ? <span className={styles.suffix}>{suffix}</span> : null}
    </span>
  );
}
