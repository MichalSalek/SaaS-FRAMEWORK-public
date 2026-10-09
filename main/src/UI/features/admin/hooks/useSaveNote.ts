// main/src/UI/features/admin/hooks/useSaveNote.ts
// TQ v5 mutation — POST /api/v1/admin/save-note
// Backend versioning: each save creates a NEW version (no update/delete).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { saveNote_IO } from '../../../../domain/admin/users/adminUsersIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

/* ─── Types ─── */

type SaveRequest = ADMIN_DTO_API_V1['SAVE_NOTE']['REQUEST'];

/* ─── Fetcher ─── */

const saveNote = saveNote_IO;

/* ─── Hook ─── */

export function useSaveNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: SaveRequest) => saveNote(req),
    // AdminNotesPage.tsx owns the user-facing error toast; suppress global fallback.
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.notes });
    },
  });
}
