import type { ReactNode } from 'react';
import styles from './HeroCountPill.module.css';

/**
 * HeroCountPill — the count pill in a screen header; the one recipe for every
 * admin screen (per-module copies drift).
 *
 * Tones:
 *   default    — a neutral count (a mark on paper).
 *   emphasized — a highlighted value (e.g. selected rows).
 *   alert      — needs attention (warning amber); with `pulse` it gets a
 *                blinking dot, the support thread list pattern.
 */
export function HeroCountPillRowAtom({ children }: { children: ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}

type HeroCountPillTone = 'default' | 'emphasized' | 'alert';

interface HeroCountPillAtomProps {
  children: ReactNode;
  /** Leading icon. Its color comes from the tone; do not set it at the call site. */
  icon?: ReactNode;
  tone?: HeroCountPillTone;
  /** Blinking dot before the content, for the `alert` tone only. */
  pulse?: boolean;
  className?: string;
}

const TONE_CLASS: Record<HeroCountPillTone, string> = {
  default: '',
  emphasized: styles.emphasized ?? '',
  alert: styles.alert ?? '',
};

export function HeroCountPillAtom({
  children,
  icon,
  tone = 'default',
  pulse = false,
  className,
}: HeroCountPillAtomProps) {
  const classes = [styles.pill, TONE_CLASS[tone], className]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes}>
      {pulse && <span className={styles.pulseDot} aria-hidden='true' />}
      {icon != null && <span className={styles.icon}>{icon}</span>}
      {children}
    </span>
  );
}
