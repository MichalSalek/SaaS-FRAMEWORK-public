// UI/features/account/UserActivityPage.parts.organism.tsx
// The category filter of the activity log: one row of chips (ChipAtom, the
// product's one selected look). Not sticky, no counters.
//
// DECISION (nie usuwaj tego komentarza) — owner 2026-10-08:
// the chips used to carry counters („Wszystko 30”, „Logowanie 60”). They
// counted the entries LOADED so far, not the entries that exist, so the same
// account showed 30 on a phone and 60 on a desktop and nobody could say what
// the number meant. The true total is stated once, under the list, when the
// whole history has been loaded.

import { ChipAtom } from '../../components/Chip/Chip.atom';
import styles from './UserActivityPage.module.css';

export type ActivityFilter = 'all' | 'LOGIN' | 'ACCOUNT' | 'GALLERY';

export interface FilterOption {
  id: ActivityFilter;
  label: string;
}

interface ActivityFilterProps {
  options: readonly FilterOption[];
  active: ActivityFilter;
  onSelect: (filter: ActivityFilter) => void;
  ariaLabel: string;
}

export function ActivityFilterOrganism({
  options,
  active,
  onSelect,
  ariaLabel,
}: ActivityFilterProps) {
  return (
    <div className={styles.filterRow} role='group' aria-label={ariaLabel}>
      {options.map(opt => (
        <ChipAtom
          key={opt.id}
          label={opt.label}
          selected={opt.id === active}
          onClick={() => onSelect(opt.id)}
        />
      ))}
    </div>
  );
}
