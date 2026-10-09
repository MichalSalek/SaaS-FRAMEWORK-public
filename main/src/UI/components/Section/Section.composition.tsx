import type { ElementType, ReactNode } from 'react';
import clsx from 'clsx';
import styles from './Section.module.css';

type SectionTone = 'plain' | 'subtle';

export interface SectionProps {
  /**
   * plain  — tło strony (bez banda), tylko rytm i kontener.
   * subtle — pełnoszerokościowy band na --color-bg-subtle (gold-tint 7%)
   *          Z OBOWIĄZKOWĄ pełną ramą hairline top+bottom.
   */
  tone?: SectionTone;
  /**
   * Hairline top+bottom. Default: true dla 'subtle' (DECYZJA ownera S24:
   * tint bez ramy „rozlewa się" na bieli), false dla 'plain'.
   */
  bordered?: boolean;
  /** Element sekcji (section/div/aside). Default: section. */
  as?: ElementType;
  /** false = inner bez max-width (rzadkie; default ogranicza do LP). */
  constrained?: boolean;
  id?: string;
  className?: string;
  innerClassName?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  children: ReactNode;
}

/**
 * Section — kompozycja sekcji LP (full-bleed band + kontener treści).
 *
 * DECISION (głos ownera S24, nie usuwaj tego komentarza):
 * Systemowa odpowiedź na „border-kwiatki" (sekcje z border-top bez
 * border-bottom, tinty bez ramy, ręcznie kopiowany breakout 100vw).
 * Sekcja na bg-subtle dostaje tu out-of-the-box: tint + PEŁNĄ ramę
 * hairline + breakout + wycentrowany kontener --lp-content-width.
 * Strona dostarcza tylko treść (header + grid). NIE kopiować już
 * `width:100vw; margin-left:calc(50% - 50vw)` per-sekcja — użyj Section.
 * Breakout liczy 100vw — wymaga `overflow-x: clip` na .content layoutu
 * (PublicLayout) przeciw h-scrollowi na klasycznych scrollbarach (S23).
 */
export function SectionComposition({
  tone = 'plain',
  bordered = tone === 'subtle',
  as: Tag = 'section',
  constrained = true,
  id,
  className,
  innerClassName,
  children,
  ...aria
}: SectionProps) {
  return (
    <Tag
      id={id}
      className={clsx(
        styles.band,
        tone === 'subtle' && styles.toneSubtle,
        bordered && styles.bordered,
        className
      )}
      aria-label={aria['aria-label']}
      aria-labelledby={aria['aria-labelledby']}>
      <div
        className={clsx(
          styles.inner,
          constrained && styles.constrained,
          innerClassName
        )}>
        {children}
      </div>
    </Tag>
  );
}
