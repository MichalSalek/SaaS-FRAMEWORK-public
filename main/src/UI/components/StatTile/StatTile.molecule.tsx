// UI/components/StatTile/StatTile.molecule.tsx
// One number with its name. Three behaviours from one shape:
//  • read-only (no `href`, no `onSelect`): information, sits flat;
//  • link (`href`): opens the list the number counts;
//  • filter (`onSelect` + `selected`): the tile IS the filter of the list
//    below it; the chosen one is inverted ink (the accent stays with the
//    screen's primary action).
// `StatTileBandMolecule` lays tiles out in ONE box separated by hairlines.
//
// WHY it exists (S126 census): the admin had five tile recipes (icon top-left,
// icon top-right, three cells in one box, bordered inner boxes, two cells),
// and none of them led anywhere. A count must lead to its items, so the link
// and filter forms are first-class here instead of a wrapper per page.

import type { ReactNode } from 'react';
import clsx from 'clsx';
import { AppLinkAtom } from '../AppLink/AppLink.atom';
import styles from './StatTile.module.css';

export interface StatTileProps {
  /** What is counted, in words. */
  label: string;
  value: ReactNode;
  /** One quiet line under the value (period, scope). */
  hint?: string;
  /** Makes the tile a link to the counted items. */
  href?: string;
  /** Makes the tile a filter button (use with `selected`). */
  onSelect?: () => void;
  /** Chosen filter / current destination. */
  selected?: boolean;
  /** The value is not known yet: keeps the geometry, shows no number. */
  loading?: boolean;
  className?: string;
}

export function StatTileMolecule({
  label,
  value,
  hint,
  href,
  onSelect,
  selected = false,
  loading = false,
  className,
}: StatTileProps) {
  const body = (
    <>
      <span className={styles.label}>{label}</span>
      <span className={styles.value} aria-busy={loading}>
        {loading ? <span className={styles.valuePending} /> : value}
      </span>
      {hint !== undefined && <span className={styles.hint}>{hint}</span>}
    </>
  );
  const classes = clsx(styles.tile, className, {
    [styles.interactive ?? '']: href !== undefined || onSelect !== undefined,
    [styles.selected ?? '']: selected,
  });

  if (href !== undefined) {
    return (
      <AppLinkAtom
        href={href}
        className={classes}
        aria-current={selected ? 'true' : undefined}>
        {body}
      </AppLinkAtom>
    );
  }
  if (onSelect !== undefined) {
    return (
      <button
        type='button'
        className={classes}
        aria-pressed={selected}
        onClick={onSelect}>
        {body}
      </button>
    );
  }
  return <div className={classes}>{body}</div>;
}

export interface StatTileBandProps {
  /** Accessible name of the group („Filtr statusu”, „Wskaźniki”). */
  ariaLabel: string;
  children: ReactNode;
  /** `flush` = no box of its own: the band is the top of a box that has one. */
  surface?: 'box' | 'flush';
  className?: string;
}

export function StatTileBandMolecule({
  ariaLabel,
  children,
  surface = 'box',
  className,
}: StatTileBandProps) {
  return (
    <div
      role='group'
      aria-label={ariaLabel}
      className={clsx(styles.band, className)}
      data-surface={surface}>
      {children}
    </div>
  );
}
