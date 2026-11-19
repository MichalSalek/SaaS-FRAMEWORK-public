import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { usePairedList } from '../../shared/pairing/hooks/usePairedList';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getPublicProfile_IO } from '../../../../domain/account/accountIO.possibilities.api';
import { SegmentedControlMolecule } from '../../../components/SegmentedControl/SegmentedControl.molecule';
import {
  useUrlSyncedState,
  type UrlStateCodec,
} from '../../../shared/hooks/useUrlSyncedState';
const codec: UrlStateCodec<'stylist' | 'salon'> = {
  keys: ['galleryScope'],
  parse: query => (query.galleryScope === 'salon' ? 'salon' : 'stylist'),
  build: value => (value === 'salon' ? { galleryScope: 'salon' } : {}),
};
export function useStylistSalonScope(stylistId: string) {
  const t = useTranslations('salon.profile');
  const tLabels = useTranslations('labels');
  const [scope, setScope] = useUrlSyncedState(codec);
  const profile = useQuery({
    queryKey: queryKeys.salon.ofStylist(stylistId),
    queryFn: ({ signal }) =>
      getPublicProfile_IO({ identifier: stylistId }, { signal }),
  });
  const connections = usePairedList();
  // DECISION: hiding public team cards must not hide the client's authorized salon gallery. The
  // authenticated group is the access-facing source.
  const connectedSalon = connections.data?.pages[0]?.salons?.find(group =>
    group.members.some(member => member.account_id === stylistId)
  );
  const salon = connectedSalon ?? profile.data?.salon_link;
  const scopeControl = salon ? (
    <>
      <TypographyAtom>{salon.name}</TypographyAtom>
      <SegmentedControlMolecule
        value={scope}
        onChange={setScope}
        ariaLabel={t('galleryScope')}
        options={[
          {
            value: 'stylist',
            label: t('stylistWorks', {
              // First word only: the label sits in a segmented pill that never
              // wraps, so a long business name is not a fallback here. A
              // stylist onboarded with the role alone has no name yet.
              name:
                profile.data?.account.display_name?.split(' ')[0] ||
                tLabels('stylistFallback'),
            }),
          },
          { value: 'salon', label: t('wholeSalonShort') },
        ]}
      />
    </>
  ) : null;
  return {
    salon,
    scopeControl,
    showSalon: scope === 'salon',
    hasSalonAccess: connectedSalon !== undefined,
  };
}
