import type { ReactNode, HTMLAttributes } from 'react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { XIcon } from '@phosphor-icons/react';
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
  // Interaktywny chip (toggle-filtr/tag) dostaje onClick przez rest. Goły <span>
  // z onClick jest niedostępny klawiaturą i nie ogłaszany jako kontrolka (WCAG
  // 2.1.1 Keyboard). Gdy chip jest klikalny — nadajemy mu semantykę przycisku:
  // role=button, wejście w tab-order i aktywację Enter/Spacją (.click() odpala
  // ten sam onClick). Display-only oraz removable (onDelete → X jest osobnym
  // <button>) chipy zostają zwykłym <span>. Wyrównuje cechy do standardu kolorów/
  // długości w UploadTagStep, które już były <button> aria-pressed (S33).
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

  // DECISION (nie usuwaj tego komentarza):
  // Wariant kolorowy NIE maluje tła kolorem. Stał tu `--chip-bg: color-mix(in
  // srgb, ${color} 15%, transparent)`, czyli 15-procentowy tint na PRYMITYWIE
  // WSPÓŁDZIELONYM, który renderuje się kilkanaście razy na jednym ekranie
  // z filtrami. Motyw „Jeden krem" (R2, głos S98/A) zakazuje dokładnie tego.
  // Prop `color` nie jest kolorem DANYCH: wszystkie wywołania podają token
  // z palety (`--color-secondary` = ink-violet, drugi akcent marki, w bibliotece
  // `/dev/ui`; `--color-success` i `--color-text-secondary` w produkcie), więc
  // był to wash koloru MARKI rozlany po prymitywie, a nie kod informacji
  // niosący znaczenie danych. Strażnik `audit:tint-discipline` go nie widział, bo obiekt
  // stylu powstaje pod stałą, a nie w literale `style={{ … }}` (dziś widzi
  // oba kształty).
  // Kolor niesie teraz RAMA i TYPOGRAFIA (R3), a tło schodzi na neutralny
  // stopień kontrolki `--color-surface-input`, ten sam co w bazowym `.chip`.
  // Token `--chip-bg` zostaje ustawiany, bo `.colored` go konsumuje, a pusta
  // zmienna wywróciłaby `background` na `initial`, czyli na przezroczystość.
  const colorStyle = color
    ? ({
        '--chip-bg': 'var(--color-surface-input)',
        '--chip-border': color,
        '--chip-text': color,
      } as React.CSSProperties)
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
