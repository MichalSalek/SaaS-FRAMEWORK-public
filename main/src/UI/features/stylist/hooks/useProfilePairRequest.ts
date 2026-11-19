import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { stylistDisplayName } from '../../shared/profile/stylist-display-name';
import {
  useAuth,
  useCurrentUser,
} from '../../../contexts/AuthContext.composition';
import { resolvePairingAudience } from '../../shared/pairing/pairingAudience';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { useIsClient } from '../../../shared/hooks/useSessionRole';
import { usePairingAccessStatus } from '../../shared/pairing/hooks/usePairingAccessStatus';
import { useRequestPair } from '../../shared/pairing/hooks/usePairRequests';
import { usePairNameGate } from '../../shared/pairing/usePairNameGate';
import type { usePairingOutcome } from '../../shared/pairing/usePairingOutcome';
import {
  pairIntentLoginHref,
  withPairIntent,
} from '../../shared/pairing/pair-intent';
import {
  clientOnboardingHref,
  trackPairRequestSent,
} from '../_client-onboarding.helpers';
import type { StylistProfileData } from '../_jsonld.helpers';
import {
  useProfilePairIntent,
  type ProfilePairIntentAction,
} from './useProfilePairIntent';

export function useProfilePairRequest(
  profile: StylistProfileData | undefined,
  onConfirmed: ReturnType<typeof usePairingOutcome>['confirm']
) {
  const router = useRouter();
  const labels = useTranslations('labels');
  const { user, isLoading: authLoading } = useCurrentUser();
  const { data: account } = useCurrentUserAccount();
  const isClient = useIsClient();
  const { accountType, isLoggedIn } = useAuth();
  const accountResolved = account !== undefined;
  const hasClientAccount = account?.client_account != null;
  const id = profile?.account.account_id ?? '';
  const isOwnProfile =
    id.length > 0 && account?.stylist_account?.account_id === id;
  const access = usePairingAccessStatus(
    id,
    user != null &&
      isClient &&
      hasClientAccount &&
      !isOwnProfile &&
      id.length > 0
  );
  const mutation = useRequestPair({ successFeedback: 'screen' });
  const gate = usePairNameGate(
    account?.name,
    profile
      ? {
          ownStylistDisplayName: account?.stylist_account?.display_name,
          confirmation: {
            stylistName: stylistDisplayName(
              profile.account,
              labels('stylistFallback')
            ),
            stylistAvatarUrl: profile.account.avatar_url,
          },
        }
      : undefined
  );

  const audience = resolvePairingAudience({
    authLoading: authLoading || (!user && isLoggedIn) || !profile,
    hasUser: user != null,
    accountResolved,
    accountType,
    ownProfile: isOwnProfile,
    hasClientAccount,
    accessChecked: access.isChecked,
    accessFetching: access.isFetching,
    accessFailed: access.checkFailed,
    isPaired: access.isPaired,
    isPending: access.isPendingRequest,
  });

  const request = () => {
    if (
      !profile ||
      (audience !== 'guest' &&
        audience !== 'clientOnboarding' &&
        audience !== 'clientPublic' &&
        audience !== 'stylistNoClient')
    ) {
      return;
    }
    if (!user) {
      void router.push(pairIntentLoginHref(router.asPath));
      return;
    }
    if (!accountResolved) {
      return;
    }
    if (!hasClientAccount) {
      void router.push(clientOnboardingHref(withPairIntent(router.asPath)));
      return;
    }
    gate.run(async details => {
      const response = await mutation.mutateAsync({
        stylist_account_id: id,
        ...(details?.note ? { note: details.note } : {}),
      });
      trackPairRequestSent(id, response);
      onConfirmed(profile.account, response);
    });
  };

  const action: ProfilePairIntentAction =
    audience === 'guest' || audience === 'clientOnboarding'
      ? 'redirect'
      : audience === 'clientPublic'
        ? 'request'
        : audience === 'owner' ||
            audience === 'stylistNoClient' ||
            audience === 'clientPaired' ||
            audience === 'clientPending'
          ? 'consume'
          : 'wait';
  useProfilePairIntent(action, request);
  return {
    audience,
    access,
    request,
    dialog: gate.dialog,
    isPending: mutation.isPending,
    canRequestPair: [
      'guest',
      'clientOnboarding',
      'clientPublic',
      'clientPending',
    ].includes(audience),
  };
}
