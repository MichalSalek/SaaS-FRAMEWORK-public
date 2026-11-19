import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { SalonProfileData } from '@kernel/models/salon-profile/salon-profile.dto';
import { getSalonProfile_IO } from '../../../domain/salon-profile/salonProfileIO.possibilities.api';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { invalidateStylistProfileCaches } from '../shared/profile/invalidate-stylist-profile.helper';
import { SalonInactiveOrganism } from './SalonInactive.organism';
import { SalonProfileEditorOrganism } from './SalonProfileEditor.organism';
import { SalonPublishWizardOrganism } from './SalonPublishWizard.organism';
import { isPublished } from './salonProfileDraft';

export function SalonProfileManageOrganism() {
  const t = useTranslations('salon.profile');
  const query = useQuery({
    queryKey: queryKeys.salon.mine,
    queryFn: ({ signal }) => getSalonProfile_IO(undefined, { signal }),
  });
  if (query.isLoading) {
    return <SkeletonAtom variant='rect' width='100%' height={300} />;
  }
  if (!query.data) {
    return (
      <ErrorStateMolecule
        message={t('loadError')}
        retryLabel={t('retry')}
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    );
  }
  return <SalonProfileForm key={query.data.account_id} profile={query.data} />;
}

/* DECISION: the salon screen has two states (owner: „it must save by itself, and the
 * publishing button is called »Opublikuj«, a one-time action, only at the beginning”).
 * (1) NOT PUBLISHED (no saved salon name, so no public page): a two-step first configuration,
 *     name and link, then optional contact and colour, ending in ONE filled „Opublikuj”. The
 *     suggested name and link are only suggestions: nothing is sent and nothing is public before
 *     that button.
 * (2) PUBLISHED: no save button. Every field saves on leaving it, every one-tap control (colour,
 *     team switch, pins) on the tap, through one single-flight queue, each box reporting its own
 *     save like the personal profile. A changed link saves too, without a confirmation: the old
 *     link stays reserved and leads to the new one (owner). The leave guard arms only
 *     while a save is pending or failed, or a typed link is not saved.
 * Do not bring back a save bar for the published state, nor publish on autosave. */
function SalonProfileForm({ profile }: { profile: SalonProfileData }) {
  const cache = useQueryClient();
  const [current, setCurrent] = useState(profile);
  const [justPublished, setJustPublished] = useState(false);
  if (profile.is_active === false) {
    return <SalonInactiveOrganism profile={profile} />;
  }
  if (!isPublished(current)) {
    return (
      <SalonPublishWizardOrganism
        profile={{ ...current, logo_url: profile.logo_url ?? null }}
        onPublished={response => {
          cache.setQueryData(queryKeys.salon.mine, response);
          // Contact is shared with her own stylist profile.
          invalidateStylistProfileCaches(cache);
          setCurrent(response);
          setJustPublished(true);
        }}
      />
    );
  }
  return (
    <SalonProfileEditorOrganism
      profile={{ ...current, logo_url: profile.logo_url ?? null }}
      justPublished={justPublished}
    />
  );
}
