import type { CSSProperties } from 'react';
import clsx from 'clsx';
import styles from './BillingToggle.module.css';

export type BillingCycle = 'monthly' | 'yearly';

type BillingToggleVariant = 'pricing' | 'account';

export interface BillingToggleProps {
  /** Current billing period, controlled by the parent. */
  cycle: BillingCycle;
  onChange: (cycle: BillingCycle) => void;
  monthlyLabel: string;
  yearlyLabel: string;
  /**
   * pricing: the pricing (LP) variant, options 11px/24px, hover rule, NO wrapper or hint.
   *           Rendered in `.tiersToggleRow`.
   * account: the in-app (pay page) variant, options 8px/18px, a column wrapper with a hint
   *           underneath + stagger-in.
   * Each variant's recipe matches the per-page implementations it replaced.
   */
  variant: BillingToggleVariant;
  /**
   * Hint under the toggle, ONLY the `account` variant (the LP has none). When given it also acts
   * as the aria-label of `role='group'`.
   */
  hintLabel?: string;
  /** Stagger index (wariant account renderuje stagger-in wrapper). */
  staggerIndex?: number;
  className?: string;
}

/**
 * BillingToggle: a segmented Monthly/Yearly switch with a -20% badge.
 *
 * Flat floor: the active option is a full pill (`.thumb`) with a solid surface + hairline that
 * slides spring-snappy under the active option. No gradient, no shadow. The active state is the
 * `data-active` attribute on the option (text colour) + `data-pos` on the thumb (transform); the
 * thumb carries the visible pill, not the option background.
 *
 * DECISION: the active state is standardized on the `data-active` attribute (the pay page used a
 * clsx class, pricing the attribute), visually identical. The two variants (`pricing`/`account`)
 * differ ONLY in the background/padding/hint recipe carried by CSS modifiers; DOM and behavior
 * are shared.
 */
export function BillingToggleMolecule({
  cycle,
  onChange,
  monthlyLabel,
  yearlyLabel,
  variant,
  hintLabel,
  staggerIndex,
  className,
}: BillingToggleProps) {
  const isYearly = cycle === 'yearly';

  const toggle = (
    <div
      className={clsx(
        styles.toggle,
        variant === 'pricing' ? styles.togglePricing : styles.toggleAccount,
        variant === 'pricing' && className
      )}
      role='group'
      aria-label={hintLabel ?? `${monthlyLabel}, ${yearlyLabel}`}>
      {/* Spring thumb (owner): the pill slides under the active option with a slight springy
        overshoot. */}
      <span
        className={styles.thumb}
        data-pos={isYearly ? 'yearly' : undefined}
        aria-hidden='true'
      />
      <button
        type='button'
        className={styles.option}
        data-active={!isYearly || undefined}
        aria-pressed={!isYearly}
        onClick={() => onChange('monthly')}>
        {monthlyLabel}
      </button>
      <button
        type='button'
        className={styles.option}
        data-active={isYearly || undefined}
        aria-pressed={isYearly}
        onClick={() => onChange('yearly')}>
        {yearlyLabel}
        {/* Marketing approximation badge ("-20%" is a symbol, locale-agnostic,
            not the exact per-plan saving). Rendered as visible text with no
            aria-label so the screen reader hears exactly what is shown (the
            prior aria-label carried a DIFFERENT string per call-site → aria≠visual). */}
        <span className={styles.saveBadge}>-20%</span>
      </button>
    </div>
  );

  // Pricing variant: a bare toggle (the parent wraps it in `.tiersToggleRow`).
  if (variant === 'pricing') {
    return toggle;
  }

  // In-app variant: a column wrapper with stagger-in + a hint underneath.
  return (
    <div
      className={clsx(styles.wrap, styles.staggerIn, className)}
      style={
        staggerIndex != null
          ? ({ '--stagger-index': staggerIndex } as CSSProperties)
          : undefined
      }>
      {toggle}
      {hintLabel != null && <span className={styles.hint}>{hintLabel}</span>}
    </div>
  );
}
