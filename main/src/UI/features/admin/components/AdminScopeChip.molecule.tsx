// admin/components/AdminScopeChip.molecule.tsx
// The removable chip a list shows when it was opened from a counter (menu
// badge, dashboard row): it names in words WHAT the list is narrowed to, and
// the sentence next to it repeats the count the admin just tapped.
//
// DECISION: one chip instead of the page's filters, because in this mode the server fixes the scope
// and ignores them; live-looking filters that do nothing reproduced the complaint "what am I
// looking at?" from the other side. Removing the chip is the one way back to the normal list. The
// WHOLE chip is the remove button (44px target): the shared ChipAtom delete glyph is a 14px target,
// too small for the only way out of a view on a phone.

import { useTranslations } from 'next-intl';
import { XIcon } from '@phosphor-icons/react';
import styles from './AdminScopeChip.module.css';

export function AdminScopeChipMolecule({
  label,
  countLabel,
  onRemove,
}: {
  /** The scope in words („Produkcja, błędy, 7 dni, do reakcji”). */
  label: string;
  /** What is counted, with the number; null while the count is unknown. */
  countLabel: string | null;
  onRemove: () => void;
}) {
  const t = useTranslations('admin.attention');
  return (
    <div className={styles.row}>
      <button
        type='button'
        className={styles.chip}
        onClick={onRemove}
        aria-label={t('removeScope', { label })}>
        <span className={styles.chipLabel}>{label}</span>
        <XIcon size={16} weight='bold' aria-hidden='true' />
      </button>
      {countLabel !== null && (
        <p className={styles.count} role='status'>
          {countLabel}
        </p>
      )}
    </div>
  );
}
