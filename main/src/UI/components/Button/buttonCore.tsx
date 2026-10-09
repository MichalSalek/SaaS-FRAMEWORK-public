import type { ReactNode } from 'react';
import clsx from 'clsx';
import { ArrowRightIcon, CircleNotchIcon } from '@phosphor-icons/react';
import styles from './Button.module.css';
import type { ButtonVariant, ButtonSize, ButtonDirection } from './Button.atom';

/**
 * Shared render-core for <Button> (renders a <button>) and <LinkButton>
 * (renders an <a>). Both share Button.module.css; W1.6 extracted the
 * className composition + icon/label layout that the two were duplicating
 * verbatim. Behaviour and markup are unchanged — the two components only differ
 * in their root element and element-specific props (disabled, href, onClick…).
 */

interface ButtonClassNameArgs {
  variant: ButtonVariant;
  size: ButtonSize;
  isIconOnly: boolean;
  /**
   * Disabled visual state. Only <Button> passes this (a <button> can be
   * disabled); <LinkButton> renders an <a>, which has no disabled state, so it
   * never applies the `.disabled` class — preserving the original behaviour.
   */
  disabled?: boolean | undefined;
  /** One-shot error-shake (validation/rejection). Only <Button> passes this. */
  shake?: boolean | undefined;
  /** The action is in flight. Only <Button> passes this. */
  loading?: boolean | undefined;
  className?: string | undefined;
}

/** Compose the shared Button/LinkButton root className. */
export function buttonClassName({
  variant,
  size,
  isIconOnly,
  disabled,
  shake,
  loading,
  className,
}: ButtonClassNameArgs): string {
  return clsx(
    styles.button,
    styles[variant],
    styles[size],
    {
      [styles.disabled ?? '']: disabled,
      [styles.iconOnly ?? '']: isIconOnly,
      [styles.shake ?? '']: shake,
      [styles.loading ?? '']: loading,
    },
    className
  );
}

interface ButtonInnerProps {
  icon?: ReactNode;
  direction?: ButtonDirection | undefined;
  /** In flight: a spinner stands in for a glyph the button already has. */
  loading?: boolean | undefined;
  children?: ReactNode;
}

/**
 * Shared inner content: optional leading icon + label + optional forward arrow.
 * Identical markup for <button> and <a> roots.
 *
 * The icon wrapper is `aria-hidden`: the accessible name comes from the label
 * text (icon+label buttons) or the button's own `aria-label` (icon-only) — never
 * the decorative glyph. This gives every button a consistent a11y contract (e.g.
 * an in-button loading spinner is silent, not announced as stray content).
 *
 * DECISION (nie usuwaj tego komentarza) — S126, `loading`: the spinner never
 * changes the button's width. It REPLACES a glyph the button already shows (the
 * leading icon, else the forward arrow: same box); with no glyph at all it lies
 * over the label, which fades out but stays in the layout and in the
 * accessible name. Before, the primitive had no such state and some twenty
 * call sites each passed their own spinner through `icon` with their own
 * keyframes, so a label-only button grew by an icon and a gap the moment it
 * was pressed (owner: „każda akcja, która wymaga czekania, ma loader” and
 * nothing may jump).
 */
export function ButtonInner({
  icon,
  direction,
  loading = false,
  children,
}: ButtonInnerProps) {
  const spinner = <CircleNotchIcon className={styles.spinner} weight='bold' />;
  const hasLeading = icon != null;
  const isForward = direction === 'forward';
  const overlay = loading && !hasLeading && !isForward;
  return (
    <>
      {hasLeading && (
        <span className={styles.icon} aria-hidden='true'>
          {loading ? spinner : icon}
        </span>
      )}
      {children != null && (
        <span className={styles.label} data-faded={overlay ? '' : undefined}>
          {children}
        </span>
      )}
      {isForward && (
        // The forward arrow is the primitive's own glyph: sized by the button's
        // font (`.icon > svg` is 1em), always the last child, never a prop.
        <span className={styles.icon} aria-hidden='true'>
          {loading && !hasLeading ? (
            spinner
          ) : (
            <ArrowRightIcon weight='regular' />
          )}
        </span>
      )}
      {overlay && (
        <span className={styles.spinnerOverlay} aria-hidden='true'>
          {spinner}
        </span>
      )}
    </>
  );
}
