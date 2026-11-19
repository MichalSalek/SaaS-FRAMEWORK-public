// main/src/UI/features/admin/hooks/useUpdateConfig.ts
// TanStack Query v5 — mutation for POST /api/v1/admin/config/update
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminUpdateConfig_IO } from '../../../../domain/admin/config/adminConfigIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

type UpdateRequest = ADMIN_DTO_API_V1['ADMIN_UPDATE_CONFIG']['REQUEST'];

const updateConfig = adminUpdateConfig_IO;

export function useUpdateConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: UpdateRequest) => updateConfig(req),
    // AdminConfigPage.tsx owns the user-facing error toast; suppress global fallback.
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.config });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.emailPipeline,
      });
      // Two keys of the runtime-config table are read publicly (the maintenance message and the
      // maintenance mode itself), and that query has its own five-minute staleTime. Without this
      // invalidation the admin flips a knob and for a few minutes sees the product behave the old way,
      // including the maintenance mode just used. The public read also has a backend cache, invalidated
      // there on write.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.public.maintenanceMessage,
      });
    },
  });
}
