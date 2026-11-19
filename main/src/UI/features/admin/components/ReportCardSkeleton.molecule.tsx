// admin/components/ReportCardSkeleton.molecule.tsx
// Loading state of the moderation queue: the box of a collapsed report card
// (thumbnail, reason, reporter line, status), so nothing moves when the
// reports arrive.

import { SkeletonAtom } from '../../../components/Skeleton/Skeleton.atom';
import styles from '../AdminModerationPage.module.css';

export function ReportCardSkeletonMolecule({ count = 4 }: { count?: number }) {
  return (
    <div className={styles.reportsList} aria-hidden='true'>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={styles.reportCard}>
          <div className={styles.reportCardToggle}>
            <div className={styles.thumbnailWrap} />
            <div className={styles.reportInfo}>
              <SkeletonAtom variant='text' width='45%' height={18} />
              <SkeletonAtom variant='text' width='70%' height={14} />
            </div>
            <div className={styles.reportStatus}>
              <SkeletonAtom variant='text' width={96} height={24} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
