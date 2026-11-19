import { queryKeys } from '../../../application/http/queryKeys.factory';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { hasOwnSalon } from '../../../application/policies/salon-ownership.policy';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { getSalonProfile_IO } from '../../../domain/salon-profile/salonProfileIO.possibilities.api';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';
import { getSalonSetupRemaining, SALON_SETUP_HREF } from './salonSetup.helpers';

export function SalonSetupEntryOrganism({
  incompleteOnly = false,
}: {
  incompleteOnly?: boolean;
}) {
  const t = useTranslations('components.salonSetupEntry');
  const { data: user } = useCurrentUserAccount();
  const account = user?.stylist_account;
  // Inherited Studio access gives a member no ownership of the owner's salon.
  const owner = hasOwnSalon(account);
  const query = useQuery({
    queryKey: queryKeys.salon.mine,
    queryFn: ({ signal }) => getSalonProfile_IO(undefined, { signal }),
    enabled: owner,
  });
  if (!owner) {
    return null;
  }
  const remaining = query.data ? getSalonSetupRemaining(query.data) : null;
  const inactive = query.data?.is_active === false;
  if (
    incompleteOnly &&
    !inactive &&
    !query.isError &&
    remaining?.length === 0
  ) {
    return null;
  }
  const description = inactive
    ? t('inactiveDescription')
    : incompleteOnly
      ? query.isError
        ? t('unknown')
        : remaining
          ? t('remaining', {
              items: remaining.map(item => t(`items.${item}`)).join(', '),
            })
          : t('loading')
      : t('description');
  return (
    <NavRowListMolecule ariaLabel={t('title')}>
      <NavRowMolecule
        href={SALON_SETUP_HREF}
        label={t(
          inactive ? 'inactiveTitle' : incompleteOnly ? 'continue' : 'title'
        )}
        description={description}
        trailing='disc'
      />
    </NavRowListMolecule>
  );
}
