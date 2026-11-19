// useUpdateStylistProfile.ts
// D5 (run 25 TRD): single TanStack mutation hook for the consolidated profile endpoint.
// Replaces useSetLocation + useSetVanityUrl + useUpdateSocialLinks.
//
// DECISION: one mutation = an atomic save of the GIVEN section payload (backend $transaction per
// payload). After autosave (owner directive: no SAVE buttons) StylistProfileSection
// calls it PER SECTION on onBlur/onChange (saveLocation/saveVanity/saveInstagram/saveAccent): N
// independent round trips instead of one. Atomicity covers the fields of ONE payload, not all
// sections at once. A shared hook = one toast/spinner/invalidation contract.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateStylistProfile_IO } from '../../../../../domain/account/accountIO.possibilities.api';
import { invalidateStylistProfileCaches } from '../invalidate-stylist-profile.helper';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { trackFlowStep } from '../../../../../application/analytics/flow-events';
import { flowErrorCode } from '../../analytics/flowErrorCode';

type UpdateStylistProfileRequest =
  ACCOUNT_DTO_API_V1['UPDATE_STYLIST_PROFILE']['REQUEST'];

export function useUpdateStylistProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: UpdateStylistProfileRequest) =>
      updateStylistProfile_IO(req),
    // DECISION: suppressGlobalError disables only layer 3 (the global MutationCache fallback). No
    // error toast is needed here: the HTTP interceptor (event-bus, layer 1) always toasts this
    // mutation's error, more precisely than a local CANNOT_UPDATE_STYLIST_PROFILE, which was removed
    // because it duplicated it.
    meta: { suppressGlobalError: true },
    onError: (error, variables) => {
      trackFlowStep('profile', 'failed', {
        fields: Object.keys(variables).sort().join(','),
        code: flowErrorCode(error),
      });
    },
    onSuccess: (_data, variables) => {
      // Field NAMES only (which section autosaved), never their values.
      trackFlowStep('profile', 'saved', {
        fields: Object.keys(variables).sort().join(','),
      });
      // Invalidate both own session and public stylist list (city/name/vanity may have changed).
      invalidateStylistProfileCaches(queryClient);
    },
  });
}
