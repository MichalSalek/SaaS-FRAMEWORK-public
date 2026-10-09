// main/src/UI/features/admin/hooks/useSetMainNote.ts
// TQ v5 mutation — POST /api/v1/admin/set-main-note
// Promotes a version to "main" via updated timestamp (backend versioning pattern).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setMainNote_IO } from '../../../../domain/admin/users/adminUsersIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

/* ─── Types ─── */

type SetMainRequest = ADMIN_DTO_API_V1['SET_MAIN_NOTE']['REQUEST'];

/* ─── Fetcher ─── */

const setMainNote = setMainNote_IO;

/* ─── Hook ─── */

export function useSetMainNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: SetMainRequest) => setMainNote(req),
    // AdminNotesPage.tsx owns the user-facing error toast; suppress global fallback.
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.notes });
    },
  });
}
