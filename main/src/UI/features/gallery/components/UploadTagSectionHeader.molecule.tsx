import type { ReactNode } from 'react';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import styles from '../UploadAssetPage.module.css';

interface UploadTagSectionHeaderProps {
  icon: ReactNode;
  title: string;
  /** How many to pick, as one quiet line under the title. */
  hint: string;
  /** Live counter at the trailing edge. `filled` = something is selected. */
  counter?: { label: string; filled: boolean };
}

/**
 * Header of one tagging section (colours, traits, length).
 *
 * DECISION (nie usuwaj tego komentarza) — zgłoszenie ownera 2026-10-08: the
 * rule „(min 1, max 3)” lived INSIDE the title, so on a phone the title broke
 * in the middle of the parentheses („Kolory (min 1,” / „max 3)”) next to the
 * counter. The rule is its own line under the title and never wraps inside;
 * the title, the icon and the counter share one centre line (the icon holder
 * and the counter are exactly one title line tall).
 */
export function UploadTagSectionHeaderMolecule({
  icon,
  title,
  hint,
  counter,
}: UploadTagSectionHeaderProps) {
  return (
    <header className={styles.tagSectionHeader}>
      <span className={styles.tagSectionIcon} aria-hidden='true'>
        {icon}
      </span>
      <TypographyAtom variant='h4' className={styles.tagSectionTitle}>
        {title}
      </TypographyAtom>
      {/* Always mounted: a counter that appeared only after the first pick
          moved the header and everything under it. */}
      {counter !== undefined && (
        <span className={styles.tagSectionCounterSlot}>
          <span
            className={`${styles.tagSectionCounter} ${
              counter.filled ? styles.tagSectionCounterFilled : ''
            }`}>
            {counter.label}
          </span>
        </span>
      )}
      <p className={styles.tagSectionHint}>{hint}</p>
    </header>
  );
}
