// UI/features/static/CompareHeroVerdict.molecule.tsx
// The comparison page's hero mark: its verdict in three rows, from the
// table's own strings (one name per thing).
//
// DECISION: every hero has its own detail; here it answers the headline's question with
// three tools and what each is for. The Nailfolio row is the chosen one, so it gets
// inverted ink like every selection in the product. (owner)

import { useTranslations } from 'next-intl';
import styles from './ComparePage.module.css';

const ROWS = [
  { nameKey: 'table.colBooking', purposeKey: 'table.rowPurposeBooking' },
  { nameKey: 'table.colSocial', purposeKey: 'table.rowPurposeSocial' },
  {
    nameKey: 'table.colNailfolio',
    purposeKey: 'table.rowPurposeNailfolio',
    chosen: true,
  },
] as const;

export function CompareHeroVerdictMolecule() {
  const t = useTranslations('static.compare');
  return (
    <ul className={styles.heroVerdict} aria-label={t('table.rowPurposeLabel')}>
      {ROWS.map(row => (
        <li
          key={row.nameKey}
          className={styles.heroVerdictRow}
          data-chosen={'chosen' in row ? 'true' : undefined}>
          <span className={styles.heroVerdictName}>{t(row.nameKey)}</span>
          <span>{t(row.purposeKey)}</span>
        </li>
      ))}
    </ul>
  );
}
