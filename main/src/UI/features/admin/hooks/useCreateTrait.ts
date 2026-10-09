// main/src/UI/features/admin/hooks/useCreateTrait.ts
// TQ v5 mutation — POST /api/v1/admin/create-trait

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createTrait_IO } from '../../../../domain/admin/colors-traits/adminColorsTraitsIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

/* ─── Types ─── */

type CreateTraitRequest = ADMIN_DTO_API_V1['ADMIN_CREATE_TRAIT']['REQUEST'];

/* ─── Hook ─── */

export function useCreateTrait() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: CreateTraitRequest) => createTrait_IO(req),
    // TraitsTab.tsx owns the user-facing error toast; suppress global fallback.
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      // F12 dedup: shared cache key — admin + public.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gallery.traits,
      });
    },
  });
}
