// main/src/UI/features/admin/hooks/useSendAnnouncementNotification.ts
// POST the saved announcement to the bell and to push, once per person.
// The screen confirms committed rows in place; the IO call declares its feedback ownership.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminSendAnnouncementNotification_IO } from '../../../../domain/admin/announcements/adminAnnouncementsIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

type SendAnnouncementRequest =
  ADMIN_DTO_API_V1['ADMIN_SEND_ANNOUNCEMENT_NOTIFICATION']['REQUEST'];

export function useSendAnnouncementNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: SendAnnouncementRequest) =>
      adminSendAnnouncementNotification_IO(req),
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.announcements,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.public.activeAnnouncements,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.all,
      });
    },
  });
}
