import type { ReactNode } from 'react';
import clsx from 'clsx';
import { ColorDotAtom, type ColorDotSize } from '../ColorDot/ColorDot.atom';
import styles from './ColorSwatch.module.css';

/* ─── Single swatch ─── */

export interface ColorSwatchProps {
  /** Display name, e.g. "Czerwone" */
  name: string;
  /** Hex color, e.g. "#ff0000" */
  hex: string;
  /** Dot size */
  size?: ColorDotSize;
  /** Whether the swatch is currently selected */
  selected?: boolean;
  /** Click handler (omit for non-interactive, e.g. summary) */
  onClick?: () => void;
  /** Opcja niedostepna w biezacych wynikach: kontrolka jest REALNIE nieaktywna,
   *  nie tylko wygaszona wizualnie (glos ownera S98). */
  disabled?: boolean;
  /** Inline mode — horizontal row layout for summaries */
  inline?: boolean;
}

export function ColorSwatchMolecule({
  name,
  hex,
  size = 'lg',
  selected = false,
  onClick,
  disabled = false,
  inline = false,
}: ColorSwatchProps) {
  const isButton = onClick != null;
  const Tag = isButton ? 'button' : 'span';

  return (
    <Tag
      type={isButton ? 'button' : undefined}
      className={clsx(
        styles.swatch,
        selected && styles.selected,
        inline && styles.inline
      )}
      // a11y: aria-pressed communicates toggle state on interactive swatches.
      // aria-label provides color name for screen readers (B1-F9); the visible
      // <span> label is redundant for sighted users but essential for AT.
      aria-pressed={isButton ? selected : undefined}
      aria-label={isButton ? name : undefined}
      disabled={isButton ? disabled || undefined : undefined}
      aria-disabled={isButton && disabled ? true : undefined}
      onClick={disabled ? undefined : onClick}>
      <ColorDotAtom color={hex} size={size} />
      <span className={styles.label} aria-hidden={isButton ? true : undefined}>
        {name}
      </span>
    </Tag>
  );
}

/* ─── Grid container ─── */

export interface ColorSwatchGridProps {
  children: ReactNode;
  className?: string;
}

export function ColorSwatchGridOrganism({
  children,
  className,
}: ColorSwatchGridProps) {
  return <div className={clsx(styles.grid, className)}>{children}</div>;
}
