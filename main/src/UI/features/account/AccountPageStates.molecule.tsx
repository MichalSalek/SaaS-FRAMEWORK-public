// UI/features/account/AccountPageStates.molecule.tsx
// Loading and load-error states shared by the account settings screens.

import { useTranslations } from 'next-intl';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import styles from './AccountPage.module.css';

/** `'list'` = hero and the seven rows; `'section'` = one section screen. */
export function AccountPageSkeletonMolecule({
  shape,
}: {
  shape: 'list' | 'section';
}) {
  return (
    <div className={styles.page} aria-busy='true'>
      {shape === 'list' ? (
        <>
          <SkeletonAtom variant='rect' width='100%' height={100} />
          <SkeletonAtom variant='rect' width='100%' height={364} />
        </>
      ) : (
        <>
          <SkeletonAtom variant='rect' width='100%' height={200} />
          <SkeletonAtom variant='rect' width='100%' height={120} />
        </>
      )}
    </div>
  );
}

export function AccountLoadErrorMolecule({
  onRetry,
  isRetrying,
}: {
  onRetry: () => void;
  isRetrying: boolean;
}) {
  const t = useTranslations('account.page');
  return (
    <div className={styles.page}>
      <ErrorStateMolecule
        message={t('loadError')}
        retryLabel={t('retry')}
        onRetry={onRetry}
        isRetrying={isRetrying}
      />
    </div>
  );
}
