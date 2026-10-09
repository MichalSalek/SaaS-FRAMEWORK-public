// main/src/UI/features/admin/hooks/useUpdateColor.ts
// TQ v5 mutation — POST /api/v1/admin/update-color

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateColor_IO } from '../../../../domain/admin/colors-traits/adminColorsTraitsIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

/* ─── Types ─── */

type UpdateColorRequest = ADMIN_DTO_API_V1['ADMIN_UPDATE_COLOR']['REQUEST'];

/* ─── Hook ─── */

export function useUpdateColor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: UpdateColorRequest) => updateColor_IO(req),
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
