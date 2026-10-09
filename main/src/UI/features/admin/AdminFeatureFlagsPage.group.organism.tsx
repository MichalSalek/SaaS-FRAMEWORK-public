// UI/features/admin/AdminFeatureFlagsPage.group.organism.tsx
// One category of feature flags: an AdminPanel with its count and its rows.

import { useTranslations } from 'next-intl';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { AdminPanelMolecule } from './components/AdminPanel.molecule';
import type { FeatureFlagItem } from './hooks/useAdminFeatureFlags';
import type { FlagCategory } from './feature-flags.model';
import {
  FlagRowMolecule,
  FlagRowSkeletonMolecule,
} from './AdminFeatureFlagsPage.row.molecule';
import styles from './AdminFeatureFlagsPage.module.css';

export function FlagGroupSkeletonOrganism({ rows }: { rows: number }) {
  return (
    <AdminPanelMolecule
      title={<SkeletonAtom variant='text' width={140} height={22} />}>
      <ul className={styles.rows} aria-busy='true'>
        {Array.from({ length: rows }, (_, index) => (
          <FlagRowSkeletonMolecule key={index} />
        ))}
      </ul>
    </AdminPanelMolecule>
  );
}

interface FlagGroupProps {
  category: FlagCategory;
  flags: readonly FeatureFlagItem[];
  pendingKeys: ReadonlySet<string>;
  failedKeys: ReadonlySet<string>;
  onToggle: (key: string, nextEnabled: boolean) => void;
}

export function FlagGroupOrganism({
  category,
  flags,
  pendingKeys,
  failedKeys,
  onToggle,
}: FlagGroupProps) {
  const t = useTranslations('admin.featureFlags');
  return (
    <AdminPanelMolecule
      title={t(`categories.${category}`)}
      aside={t('categoryCount', { count: flags.length })}>
      <ul className={styles.rows}>
        {flags.map(flag => (
          <FlagRowMolecule
            key={flag.id}
            flag={flag}
            isPending={pendingKeys.has(flag.key)}
            hasFailed={failedKeys.has(flag.key)}
            onToggle={onToggle}
          />
        ))}
      </ul>
    </AdminPanelMolecule>
  );
}
