// UI/features/salon-staff/hooks/useRespondInvitation.ts
// TQ v5 mutation: POST /api/v1/salon/invitations/respond. The invited person
// accepts (consent to be listed by name and photo in that salon's team) or
// declines (membership removed) one invitation.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SALON_STAFF_DTO_API_V1 } from '@kernel/models/salon-staff/salon-staff.dto';
import { respondSalonInvitation_IO } from '../../../../domain/salon-staff/salonStaffIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

export type RespondInvitationInput =
  SALON_STAFF_DTO_API_V1['SALON_STAFF_RESPOND_INVITATION']['REQUEST'];

export function useRespondInvitation() {
  const queryClient = useQueryClient();

  return useMutation({
    // DECISION (nie usuwaj tego komentarza): the screen owns the feedback for
    // this action. Success events are in eventsDisallowedForUI (the card turns
    // into an inline confirmation), and a business 4xx (the invitation was
    // withdrawn meanwhile, a stale tab) is shown INLINE on the card with a retry,
    // so `silentBusinessError` keeps the interceptor from toasting the same
    // failure a second time. 401 and 5xx still toast (the flag never silences
    // them), and suppressGlobalError switches off only the generic layer-3
    // fallback (contract: queryClient.config.ts).
    mutationFn: (input: RespondInvitationInput) =>
      respondSalonInvitation_IO(input, { silentBusinessError: true }),
    meta: { suppressGlobalError: true },
    // Settled, not success: after a failure the list is refetched as well, so an
    // invitation that no longer exists leaves the screen instead of offering a
    // retry that can never land.
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.staff.myInvitations,
      });
    },
  });
}
