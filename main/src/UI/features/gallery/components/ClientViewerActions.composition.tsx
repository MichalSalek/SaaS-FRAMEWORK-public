// UI/features/gallery/components/ClientViewerActions.composition.tsx
// The viewer's actions for a signed-in client: the same block, plus her
// inspiration session with this photo's stylist. A separate component because
// the session action reads the client's own sessions and pairs, which nobody
// else may query (see usePhotoSessionAction).

import type { ComponentProps } from 'react';
import { usePhotoSessionAction } from '../../shared/sessions/hooks/usePhotoSessionAction';
import { ViewerActionsMolecule } from '../PhotoDetailActions.molecule';

type ViewerProps = Omit<
  ComponentProps<typeof ViewerActionsMolecule>,
  'sessionAction'
>;

export function ClientViewerActionsComposition({
  stylistAccountId,
  photoId,
  ...viewerProps
}: ViewerProps & { stylistAccountId: string; photoId: string }) {
  const sessionAction = usePhotoSessionAction(stylistAccountId, photoId);
  return (
    <ViewerActionsMolecule {...viewerProps} sessionAction={sessionAction} />
  );
}
