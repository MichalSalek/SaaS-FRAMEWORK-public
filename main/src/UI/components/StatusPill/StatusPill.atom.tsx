import type { CSSProperties, ReactNode } from 'react';
import clsx from 'clsx';
import styles from './StatusPill.module.css';

export interface StatusPillProps {
  /**
   * Any CSS color or custom-property reference (e.g. `var(--color-success)`).
   * Injected as the `--statusColor` custom property that drives the frozen
   * tint recipe (12% bg / 30% border / 85% text). Domain status→token maps
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
 * Canonical OKLCH-tinted status chip. ONE visual recipe (sessions canon);
 * callers supply the status color and label. Replaces the 5 hand-rolled
 * `.statusPill` blocks across sessions + support (FDX FAZA 5 / W5.5).
 *
 * DECISION (nie usuwaj tego komentarza): recepturę ujednolicono na
 * sessions-kanon (12%/30%/85%). Support miał drobne odchyłki (list: 10% tint
 * nad transparent / 26% border / 70% text; detail: 12% nad bg-paper / 32% /
 * 85%) — wizualnie ≈równoważne w OKLCH, a oba pliki same deklarowały „Mirrors
 * ClientSessionsPage StatusPill DNA". Różnica display (uppercase + 0.04em
 * tracking) to świadomy wybór czytelności statusów support — zachowana przez
 * prop `uppercase`, nie przez osobną recepturę tła.
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
      style={{ '--statusColor': color } as CSSProperties}>
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
