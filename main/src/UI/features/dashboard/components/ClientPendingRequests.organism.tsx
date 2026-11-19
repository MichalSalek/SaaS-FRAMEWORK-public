import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../../application/routing/buildRoute';
import { AvatarAtom } from '../../../components/Avatar/Avatar.atom';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import {
  NavRowListMolecule,
  NavRowListSkeletonMolecule,
  NavRowMolecule,
} from '../../../components/NavRow/NavRow.molecule';
import type { useMyPendingRequests } from '../../shared/pairing/hooks/usePairRequests';
import { PushSoftAskOrganism } from '../../shared/push/PushSoftAsk.organism';

export function ClientPendingRequestsOrganism({
  query,
}: {
  query: ReturnType<typeof useMyPendingRequests>;
}) {
  const t = useTranslations('dashboard.client');
  const labels = useTranslations('labels');
  const buttons = useTranslations('buttons');

  if (query.data === undefined) {
    return query.isError ? (
      <ErrorStateMolecule
        message={t('pendingRequestsLoadError')}
        retryLabel={buttons('retry')}
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    ) : (
      <NavRowListSkeletonMolecule rows={1} leading lines={2} />
    );
  }

  if (query.data.requests.length === 0) {
    return null;
  }

  return (
    <>
      <NavRowListMolecule label={t('coldStart.waitingLabel')}>
        {query.data.requests.map(request => {
          const name =
            request.display_name?.trim() || labels('stylistFallback');
          return (
            <NavRowMolecule
              key={request.pair_id}
              href={buildRoute(ROUTES_FRONT.STYLIST_PROFILE, {
                identifier: request.stylist_account_id,
              })}
              leading={
                <AvatarAtom
                  name={name}
                  src={request.avatar_url ?? undefined}
                  size='md'
                  decorative
                />
              }
              label={name}
              description={t('coldStart.waitingHint')}
              trailing='disc'
            />
          );
        })}
      </NavRowListMolecule>
      <PushSoftAskOrganism moment='pairRequest' />
    </>
  );
}
