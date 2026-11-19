// UI/features/salon-staff/hooks/useRespondInvitation.ts
// TQ v5 mutation: POST /api/v1/salon/invitations/respond. The invited person
// accepts (consent to be listed by name and photo in that salon's team) or
// declines (membership removed) one invitation.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SALON_STAFF_DTO_API_V1 } from '@kernel/models/salon-staff/salon-staff.dto';
import { respondSalonInvitation_IO } from '../../../../../domain/salon-staff/salonStaffIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import { trackFlowStep } from '../../../../../application/analytics/flow-events';
import { flowErrorCode } from '../../analytics/flowErrorCode';

export type RespondInvitationInput =
  SALON_STAFF_DTO_API_V1['SALON_STAFF_RESPOND_INVITATION']['REQUEST'];

export function useRespondInvitation() {
  const queryClient = useQueryClient();

  return useMutation({
    // DECISION: the screen owns the feedback for this action. Success events are in
    // eventsDisallowedForUI and a business 4xx (invitation withdrawn, stale tab) is shown
    // inline on the card, so `silentBusinessError` stops a duplicate toast; 401 and 5xx
    // still toast. suppressGlobalError only drops the generic fallback (queryClient.config.ts).
    mutationFn: (input: RespondInvitationInput) =>
      respondSalonInvitation_IO(input, { silentBusinessError: true }),
    meta: { suppressGlobalError: true },
    // Settled, not success: after a failure the list is refetched as well, so an
    // invitation that no longer exists leaves the screen instead of offering a
    // retry that can never land.
    onError: error => {
      trackFlowStep('salon_team', 'failed', {
        action: 'respond_invitation',
        code: flowErrorCode(error),
      });
    },
    onSuccess: (_data, input) => {
      trackFlowStep(
        'salon_team',
        input.response === 'ACCEPT'
          ? 'invitation_accepted'
          : 'invitation_declined',
        { via: 'in_app' }
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.current,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.staff.myTeam });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.staff.myInvitations,
      });
      // The answer closes the invitee's notification (server-side).
      void queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.all,
      });
    },
  });
}
