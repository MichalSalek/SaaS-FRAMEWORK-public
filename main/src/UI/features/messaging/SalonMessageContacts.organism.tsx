import { useState } from 'react';
import { SalonContactDialogOrganism } from './SalonContactDialog.organism';
import { useTranslations } from 'next-intl';
import { usePairedList } from '../shared/pairing/hooks/usePairedList';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
export function SalonMessageContactsOrganism() {
  const query = usePairedList();
  const t = useTranslations('salon.profile');
  const [target, setTarget] = useState<{
    account_id: string;
    name: string;
  } | null>(null);
  if (query.isError) {
    return (
      <ErrorStateMolecule
        message={t('loadError')}
        retryLabel={t('retry')}
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    );
  }
  const salons = query.data?.pages[0]?.salons ?? [];
  if (!salons.length) {
    return null;
  }
  return (
    <section>
      <TypographyAtom variant='h2' as='h2'>
        {t('salonContacts')}
      </TypographyAtom>
      {salons.map(salon => (
        <NavRowListMolecule key={salon.account_id} ariaLabel={salon.name}>
          {salon.members.map(person => (
            <NavRowMolecule
              key={person.account_id}
              label={person.name}
              description={t('startMessage', { name: person.name })}
              leading={
                <AvatarAtom
                  name={person.name}
                  src={person.avatar_url ?? undefined}
                  decorative
                />
              }
              onClick={() => setTarget(person)}
              trailing='disc'
            />
          ))}
        </NavRowListMolecule>
      ))}
      <SalonContactDialogOrganism
        target={target}
        onClose={() => setTarget(null)}
      />
    </section>
  );
}
