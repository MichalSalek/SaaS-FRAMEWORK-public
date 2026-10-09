// main/src/UI/features/admin/hooks/useCreateColor.ts
// TQ v5 mutation — POST /api/v1/admin/create-color

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createColor_IO } from '../../../../domain/admin/colors-traits/adminColorsTraitsIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

/* ─── Types ─── */

type CreateColorRequest = ADMIN_DTO_API_V1['ADMIN_CREATE_COLOR']['REQUEST'];

/* ─── Hook ─── */

export function useCreateColor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: CreateColorRequest) => createColor_IO(req),
    // ColorsTab.tsx owns the user-facing error toast; suppress global fallback.
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      // DECISION (nie usuwaj tego komentarza):
      // F12 dedup: shared cache key. Admin i public explore używają identycznego cache key
      // (queryKeys.gallery.colors), pojedyncza inwalidacja wystarcza.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gallery.colors,
      });
    },
  });
}
