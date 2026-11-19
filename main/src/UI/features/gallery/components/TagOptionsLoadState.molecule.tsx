// UI/features/gallery/components/TagOptionsLoadState.molecule.tsx
// Loading / failure state for a REQUIRED tag option list (colors, traits) in
// the upload wizard (step 2) and the photo edit modal.
//
// Before this the list hooks returned `[]` while loading AND after a failure,
// so the section rendered empty: „there is nothing to pick", with „Dalej" /
// „Zapisz" blocked and no way out except starting over. Now loading shows a
// skeleton row and a failure shows an inline retry INSIDE the section; the
// rest of the form (crop, other sections) is untouched.

import type { ReactNode } from 'react';
import { SkeletonAtom } from '../../../components/Skeleton/Skeleton.atom';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';

const SKELETON_ITEMS = [0, 1, 2, 3, 4, 5] as const;

interface TagOptionsLoadStateProps {
  /** The option list already has entries (cached data wins over any status). */
  hasOptions: boolean;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string;
  retryLabel: string;
  onRetry: () => void;
  /** A retry is in flight (the backing query's `isFetching`). */
  isRetrying?: boolean;
  children: ReactNode;
}

export function TagOptionsLoadStateMolecule({
  hasOptions,
  isLoading,
  isError,
  errorMessage,
  retryLabel,
  onRetry,
  isRetrying = false,
  children,
}: TagOptionsLoadStateProps) {
  if (hasOptions) {
    return <>{children}</>;
  }
  if (isError) {
    return (
      <ErrorStateMolecule
        message={errorMessage}
        retryLabel={retryLabel}
        onRetry={onRetry}
        isRetrying={isRetrying}
      />
    );
  }
  if (isLoading) {
    return (
      <div
        aria-busy='true'
        style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)' }}>
        {SKELETON_ITEMS.map(i => (
          <SkeletonAtom key={i} variant='rect' width={72} height={40} />
        ))}
      </div>
    );
  }
  return <>{children}</>;
}
