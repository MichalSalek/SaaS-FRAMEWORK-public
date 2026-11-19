import { getColorDisplay } from '../ColorDot/ColorDot.config';
import type { ReactNode } from 'react';
import { colorVariableStyle } from '../../../application/colors/color-css-variables';
import { useSwatchMotion } from './ColorSwatch.motion';
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
  /** Option unavailable in the current results: the control is REALLY inactive, not only
   *  dimmed visually (owner). */
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
  const display = getColorDisplay(hex);
  const motionRef = useSwatchMotion(selected, disabled || onClick == null);
  const isButton = onClick != null;
  const Tag = isButton ? 'button' : 'span';

  return (
    <Tag
      ref={motionRef}
      data-size={size}
      style={colorVariableStyle('--polish-mark', display.mark)}
      type={isButton ? 'button' : undefined}
      className={clsx(
        styles.swatch,
        selected && styles.selected,
        inline && styles.inline
      )}
      // a11y: aria-pressed communicates toggle state on interactive swatches.
      // aria-label provides color name for screen readers; the visible
      // <span> label is redundant for sighted users but essential for AT.
      aria-pressed={isButton ? selected : undefined}
      aria-label={isButton ? name : undefined}
      disabled={isButton ? disabled || undefined : undefined}
      aria-disabled={isButton && disabled ? true : undefined}
      onClick={disabled ? undefined : onClick}>
      <ColorDotAtom color={hex} size={size} />
      <span data-motion-mark className={styles.mark} aria-hidden='true'>
        ✓
      </span>
      <span data-motion-wave className={styles.wave} aria-hidden='true' />
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
