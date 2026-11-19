import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { usePublicFeatureFlag } from '../../../application/feature-flags/client-feature-flags';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { acceptSessionContainer_IO } from '../../../domain/session-container/sessionContainerIO.possibilities.api';
import { trackFlowStep } from '../../../application/analytics/flow-events';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { SessionAcceptanceStatusMolecule } from './SessionAcceptanceStatus.molecule';
import styles from './SessionDetailPage.module.css';

export function SessionAcceptanceActionsMolecule({
  sessionId,
  canAccept,
  acceptedAt,
  changedAt,
}: {
  sessionId: string;
  canAccept: boolean;
  acceptedAt?: string | null | undefined;
  changedAt?: string | null | undefined;
}) {
  const t = useTranslations('pages.sessions');
  const enabled = usePublicFeatureFlag(
    FEATURE_FLAG_KEYS.SESSION_ACCEPTANCE_ENABLED
  );
  const queryClient = useQueryClient();
  const accept = useMutation({
    mutationFn: () => acceptSessionContainer_IO({ session_id: sessionId }),
    onSuccess: async () => {
      trackFlowStep('session', 'accepted', { measurement_version: 1 });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sessionContainer.all,
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.messaging.conversationsAll,
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.all,
      });
    },
    meta: { suppressGlobalError: true },
  });
  if (!acceptedAt && !canAccept) {
    return null;
  }
  return (
    <div className={styles.heroFacts}>
      <SessionAcceptanceStatusMolecule
        acceptedAt={acceptedAt}
        changedAt={changedAt}
      />
      {enabled && canAccept && !acceptedAt && (
        <ButtonAtom
          variant='primary'
          size='md'
          loading={accept.isPending}
          onClick={() => accept.mutate()}>
          {t('acceptInspirations')}
        </ButtonAtom>
      )}
    </div>
  );
}
