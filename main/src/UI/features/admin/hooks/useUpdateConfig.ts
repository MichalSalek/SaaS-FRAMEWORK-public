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
      // Dwa klucze tabeli runtime-config są czytane publicznie (komunikat przerwy
      // i sam tryb przerwy), a ten query ma własny, pięciominutowy staleTime.
      // Bez tej invalidacji administrator przełącza knob i przez kilka minut widzi
      // produkt zachowujący się po staremu — łącznie z trybem przerwy, którego
      // właśnie użył. Publiczny odczyt ma jeszcze cache po stronie backendu,
      // unieważniany tam przy zapisie.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.public.maintenanceMessage,
      });
    },
  });
}
