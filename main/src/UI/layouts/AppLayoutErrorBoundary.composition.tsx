import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorBoundaryComposition } from '../components/ErrorBoundary.composition';
import { useErrorBoundaryCopy } from '../components/useErrorBoundaryCopy';

export function AppLayoutErrorBoundaryComposition({
  children,
}: {
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const copy = useErrorBoundaryCopy();
  return (
    <ErrorBoundaryComposition
      fallbackTitle={copy.title}
      fallbackAction={copy.action}
      onReset={() => {
        void queryClient.resetQueries();
      }}>
      {children}
    </ErrorBoundaryComposition>
  );
}
