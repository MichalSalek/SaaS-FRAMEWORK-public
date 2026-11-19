import type { ReactNode } from 'react';
import { colorVariableStyle } from '../../../application/colors/color-css-variables';
import clsx from 'clsx';
import styles from './StatusPill.module.css';

export interface StatusPillProps {
  /**
   * Any CSS color or custom-property reference (e.g. `var(--color-success)`).
   * Injected as the `--statusColor` custom property that drives the text
   * mix and the dot (see StatusPill.module.css). Domain status→token maps
   * live at the call-site and feed this prop.
   */
  color: string;
  /** Visible status label. */
  label: ReactNode;
  /**
   * Show the 6px dot before the label. Defaults to true. Pass a custom
   * `icon` instead when the status reads better as a glyph (e.g. resolved /
   * closed support threads).
   */
  showDot?: boolean;
  /** Pulse the dot (signal: "live"). Only applies when the dot is shown. */
  pulse?: boolean;
  /** Custom leading glyph in place of the dot (e.g. a Phosphor icon). */
  icon?: ReactNode;
  /** Uppercase + wider tracking — badge presentation (support threads). */
  uppercase?: boolean;
  /**
   * Solid fill instead of the 12% tint. Reserved for the one level in a status
   * family that has to break out of it — a critical severity that must not read
   * as "one more colour in the row". Use sparingly: if two statuses on the same
   * surface are solid, neither is loud any more.
   */
  emphasis?: 'tint' | 'solid';
  /**
   * Accessible name when the visible label is an abbreviation or a composite
   * (e.g. "LIVE 60s", where a screen reader should hear the full cadence).
   */
  ariaLabel?: string;
  className?: string;
}

/**
 * Canonical status chip. ONE visual recipe; callers supply the status color
 * and label. No hand-rolled `.statusPill` blocks per feature.
 *
 * DECISION: one recipe for sessions and support (fill/border/text mixes in
 * StatusPill.module.css). The display difference (uppercase + 0.04em tracking) is a deliberate
 * readability choice for support statuses, kept through the `uppercase` prop, not through a
 * separate background recipe.
 */
export function StatusPillAtom({
  color,
  label,
  showDot = true,
  pulse = false,
  icon,
  uppercase = false,
  emphasis = 'tint',
  ariaLabel,
  className,
}: StatusPillProps) {
  return (
    <span
      className={clsx(
        styles.statusPill,
        uppercase && styles.uppercase,
        emphasis === 'solid' && styles.solid,
        className
      )}
      {...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {})}
      style={colorVariableStyle('--statusColor', color)}>
      {icon ??
        (showDot ? (
          <span
            className={clsx(styles.statusDot, pulse && styles.statusDotPulse)}
            aria-hidden='true'
          />
        ) : null)}
      {label}
    </span>
  );
}
