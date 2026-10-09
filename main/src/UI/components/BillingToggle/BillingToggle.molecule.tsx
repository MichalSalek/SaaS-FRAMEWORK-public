import type { CSSProperties } from 'react';
import clsx from 'clsx';
import styles from './BillingToggle.module.css';

export type BillingCycle = 'monthly' | 'yearly';

type BillingToggleVariant = 'pricing' | 'account';

export interface BillingToggleProps {
  /** Aktualny okres rozliczeniowy — kontrolowany przez rodzica. */
  cycle: BillingCycle;
  onChange: (cycle: BillingCycle) => void;
  monthlyLabel: string;
  yearlyLabel: string;
  /**
   * pricing — wariant cennika (LP): track na bg-main, opcje 11px/24px, hover
   *           rule, BEZ wrappera i hintu. Renderowany w `.tiersToggleRow`.
   * account — wariant in-app (pay page): track na bg-subtle, opcje 8px/18px,
   *           wrapper kolumnowy z hintem pod spodem + stagger-in.
   * Receptura każdego wariantu jest 1:1 z poprzednimi per-page implementacjami
   * (W5.5 ekstrakcja 2 toggli, pixel-parity).
   */
  variant: BillingToggleVariant;
  /**
   * Hint pod toggle'em — TYLKO wariant `account` (LP go nie ma). Gdy podany,
   * pełni też rolę aria-label dla `role='group'` (parytet z poprzednią impl).
   */
  hintLabel?: string;
  /** Stagger index (wariant account renderuje stagger-in wrapper). */
  staggerIndex?: number;
  className?: string;
}

/**
 * BillingToggle — segmentowy przełącznik Miesięcznie/Rocznie z badge'em -20%.
 *
 * Floor 7×ZERO (flat): aktywna opcja = pełna pigułka (`.thumb`) z solidną
 * powierzchnią + hairline, ślizgająca się spring-snappy pod aktywną opcją.
 * Zero gradientu, zero cienia. Stan aktywny niesie atrybut `data-active` na
 * opcji (kolor tekstu) + `data-pos` na thumbie (transform) — wizualną pigułkę
 * niesie thumb, nie tło opcji.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Stan aktywny standardyzowany na atrybucie `data-active` (wcześniej pay page
 * używał clsx-klasy `.billingOptionActive`, cennik atrybutu `[data-active]`) —
 * wizualnie identyczne, clsx-vs-attr to detal implementacyjny. Dwa warianty
 * (`pricing`/`account`) różnią się TYLKO recepturą tła/paddingu/hintu, którą
 * niosą modyfikatory CSS — DOM i zachowanie są wspólne.
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
      {/* Spring thumb (głos ownera S28/5 = D): pigułka ślizga się pod aktywną
        opcją z lekkim sprężystym przeskoczeniem (overshoot). */}
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

  // Wariant cennika: goły toggle (rodzic owija go w `.tiersToggleRow`).
  if (variant === 'pricing') {
    return toggle;
  }

  // Wariant in-app: kolumnowy wrapper ze stagger-in + hint pod spodem.
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
