// admin/components/TaxonomyListSkeleton.molecule.tsx
// Loading shape of the colours and traits lists: the white box and rows of
// the list that replaces it, so nothing moves when the data arrives.

import { SkeletonAtom } from '../../../components/Skeleton/Skeleton.atom';
import styles from '../AdminColorsTraitsPage.module.css';

interface TaxonomyListSkeletonProps {
  rows?: number;
  /** Colours lead with a swatch; traits do not. */
  withSwatch?: boolean;
}

export function TaxonomyListSkeletonMolecule({
  rows = 6,
  withSwatch = false,
}: TaxonomyListSkeletonProps) {
  return (
    <div className={styles.skeletonList} aria-busy='true'>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={styles.skeletonRow}>
          {withSwatch && (
            <SkeletonAtom variant='circle' width={40} height={40} />
          )}
          <SkeletonAtom variant='text' width='40%' height={16} />
        </div>
      ))}
    </div>
  );
}
