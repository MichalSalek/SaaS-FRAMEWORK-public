import type { ReactNode } from 'react';
import styles from './HeroCountPill.module.css';

/**
 * HeroCountPill — pigułka z licznikiem w nagłówku ekranu.
 *
 * Siedem modułów admina trzymało bajtowo identyczny blok `.heroPill`
 * (+ `.heroPillRow`, `.heroPillIcon`), a każda zmiana kanonu wymagała siedmiu
 * edycji i po każdej jedna kopia zostawała w tyle. To jest ta receptura,
 * przeniesiona bez zmiany piksela.
 *
 * Tony:
 *   default    — licznik neutralny (znak na kremie).
 *   emphasized — wyróżniona wartość (np. zaznaczone wiersze).
 *   alert      — wymaga uwagi (ostrzegawczy amber); z `pulse` dostaje
 *                migającą kropkę, wzorzec z listy wątków wsparcia.
 */
export function HeroCountPillRowAtom({ children }: { children: ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}

type HeroCountPillTone = 'default' | 'emphasized' | 'alert';

interface HeroCountPillAtomProps {
  children: ReactNode;
  /** Ikona wiodąca. Kolor bierze z tonu, więc nie ustawiaj go w call-site. */
  icon?: ReactNode;
  tone?: HeroCountPillTone;
  /** Migająca kropka przed treścią — tylko dla tonu `alert`. */
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
