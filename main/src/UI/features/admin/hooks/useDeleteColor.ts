// main/src/UI/features/admin/hooks/useDeleteColor.ts
// TQ v5 mutation — POST /api/v1/admin/delete-color

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteColor_IO } from '../../../../domain/admin/colors-traits/adminColorsTraitsIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

/* ─── Types ─── */

type DeleteColorRequest = ADMIN_DTO_API_V1['ADMIN_DELETE_COLOR']['REQUEST'];

/* ─── Hook ─── */

export function useDeleteColor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: DeleteColorRequest) => deleteColor_IO(req),
    // ColorsTab.tsx owns the user-facing error toast; suppress global fallback.
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      // F12 dedup: shared cache key — admin + public.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gallery.colors,
      });
    },
  });
}
