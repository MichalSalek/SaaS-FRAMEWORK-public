import type { ReactNode, HTMLAttributes } from 'react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { XIcon } from '@phosphor-icons/react';
import { colorVariableStyle } from '../../../application/colors/color-css-variables';
import styles from './Chip.module.css';

type ChipSize = 'sm' | 'md';

export interface ChipProps extends Omit<
  HTMLAttributes<HTMLSpanElement>,
  'color'
> {
  label: string;
  color?: string | undefined;
  onDelete?: () => void;
  size?: ChipSize;
  /**
   * Chosen state of a toggle chip. One look for the whole product: inverted
   * ink (the accent stays with the screen's primary action). On an interactive
   * chip it also sets `aria-pressed`, so call-sites stop repeating both.
   */
  selected?: boolean;
  className?: string;
}

export function ChipAtom({
  label,
  color,
  onDelete,
  size = 'md',
  selected,
  className,
  ...rest
}: ChipProps) {
  const tA11y = useTranslations('a11y');
  // An interactive chip (filter toggle / tag) gets onClick through rest. A bare <span> with
  // onClick is not keyboard-accessible and is not announced as a control (WCAG 2.1.1 Keyboard).
  // When the chip is clickable it gets button semantics: role=button, a place in the tab order and
  // Enter/Space activation (.click() fires the same onClick). Display-only and removable chips
  // (onDelete: the X is a separate <button>) stay a plain <span>. This matches the colour/length
  // chips in UploadTagStep, which were already <button> aria-pressed.
  const interactive = typeof rest.onClick === 'function';
  const interactiveProps = interactive
    ? {
        role: 'button',
        tabIndex: 0,
        ...(selected === undefined ? {} : { 'aria-pressed': selected }),
        onKeyDown: (e: React.KeyboardEvent<HTMLSpanElement>) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.currentTarget.click();
          }
        },
      }
    : {};

  // DECISION: the colored variant does NOT paint the background with the color. A 15% tint on this
  // shared primitive (rendered a dozen times per filter screen) is what the "one cream" theme
  // forbids; `color` is a brand palette token, not a data color, so it was a brand wash, not
  // information. The color is carried by the frame and the typography and the background stays the
  // neutral control step `--color-surface-input`. `--chip-bg` is still set because `.colored`
  // consumes it and an empty variable would reset `background` to transparent.
  const colorStyle = color
    ? {
        ...colorVariableStyle('--chip-bg', 'var(--color-surface-input)'),
        ...colorVariableStyle('--chip-border', color),
        ...colorVariableStyle('--chip-text', color),
      }
    : undefined;

  return (
    <span
      className={clsx(
        styles.chip,
        styles[size],
        {
          [styles.colored ?? '']: Boolean(color),
          [styles.selected ?? '']: selected === true,
        },
        className
      )}
      style={colorStyle}
      {...rest}
      {...interactiveProps}>
      <span className={styles.label}>{label}</span>
      {onDelete && (
        <button
          type='button'
          className={styles.deleteButton}
          onClick={e => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={tA11y('remove', { label })}>
          <XIcon size={size === 'sm' ? 12 : 14} />
        </button>
      )}
    </span>
  );
}

/* ─── ChipGroup ─── */

export interface ChipGroupProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
}

export function ChipGroupMolecule({
  children,
  className,
  ...rest
}: ChipGroupProps) {
  return (
    <div className={clsx(styles.group, className)} {...rest}>
      {children}
    </div>
  );
}
