import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { getMySalonTeam_IO } from '../../../../domain/salon-staff/salonStaffIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../../components/NavRow/NavRow.molecule';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';

export function SalonMembershipWaitingMolecule() {
  const t = useTranslations('components.salonMembership');
  const query = useQuery({
    queryKey: queryKeys.staff.myTeam,
    queryFn: ({ signal }) => getMySalonTeam_IO(undefined, { signal }),
  });
  if (query.isError) {
    return (
      <ErrorStateMolecule
        message={t('loadError')}
        retryLabel={t('retry')}
        onRetry={() => void query.refetch()}
      />
    );
  }
  const salons = query.data?.awaiting_stylist_salon_names ?? [];
  if (salons.length === 0) {
    return null;
  }
  return (
    <NavRowListMolecule label={t('title')}>
      {salons.map(salon => (
        <NavRowMolecule
          key={salon}
          label={t('activate')}
          description={t('body', { salon })}
          href={ROUTES_FRONT.USER_ACTIVATE_STYLIST}
          trailing='disc'
        />
      ))}
    </NavRowListMolecule>
  );
}
