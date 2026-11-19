// main/src/UI/features/admin/hooks/useCreateAnnouncement.ts
// TQ v5 mutation - POST /api/v1/admin/announcements/create

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminCreateAnnouncement_IO } from '../../../../domain/admin/announcements/adminAnnouncementsIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

/* ─── Types ─── */

type CreateAnnouncementRequest =
  ADMIN_DTO_API_V1['ADMIN_CREATE_ANNOUNCEMENT']['REQUEST'];

/* ─── Fetcher ─── */

const createAnnouncement = adminCreateAnnouncement_IO;

/* ─── Hook ─── */

export function useCreateAnnouncement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: CreateAnnouncementRequest) => createAnnouncement(req),
    // AdminAnnouncementsPage.tsx owns the user-facing error toast; suppress global fallback.
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.announcements,
      });
      // Admin CRUD feeds the public banner too — refresh it so the admin sees
      // the effect of their change without a hard reload.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.public.activeAnnouncements,
      });
    },
  });
}
