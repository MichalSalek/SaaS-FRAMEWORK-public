// main/src/UI/features/admin/hooks/useToggleFeatureFlag.ts
// TanStack Query v5 — mutation for POST /api/v1/admin/feature-flags/toggle
// Optimistic update: flag flips immediately, rolls back on error.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { adminToggleFeatureFlag_IO } from '../../../../domain/admin/config/adminConfigIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

/* ─── Types ─── */

type ToggleRequest = ADMIN_DTO_API_V1['ADMIN_TOGGLE_FEATURE_FLAG']['REQUEST'];
type FlagsSnapshot = ADMIN_DTO_API_V1['ADMIN_GET_FEATURE_FLAGS']['RESPONSE'];

/* ─── Fetcher ─── */

const toggleFeatureFlag = adminToggleFeatureFlag_IO;

/* ─── Hook ─── */

export function useToggleFeatureFlag() {
  const queryClient = useQueryClient();
  const flagsKey = queryKeys.admin.featureFlags;

  return useMutation({
    mutationFn: (req: ToggleRequest) => toggleFeatureFlag(req),
    meta: { suppressGlobalError: true },

    onMutate: async (req: ToggleRequest) => {
      // Cancel in-flight refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: flagsKey });

      // Snapshot previous data for rollback
      const snapshot = queryClient.getQueryData<FlagsSnapshot>(flagsKey);

      // Optimistically flip the flag
      queryClient.setQueryData<FlagsSnapshot>(flagsKey, prev => {
        if (!prev) {
          return prev;
        }
        return prev.map(flag =>
          flag.key === req.key
            ? {
                ...flag,
                is_enabled: req.is_enabled,
                updated_at: new Date().toISOString(),
              }
            : flag
        );
      });

      return { snapshot };
    },

    onError: (_err, req, context) => {
      // Roll back ONLY the flag this mutation flipped. Restoring the whole
      // snapshot also reverted any other flag toggled meanwhile (parallel
      // toggles are allowed, see pendingKeys in the page), so a still-pending
      // or already-saved switch jumped back until the next refetch.
      const previous = context?.snapshot?.find(flag => flag.key === req.key);
      if (previous !== undefined) {
        queryClient.setQueryData<FlagsSnapshot>(flagsKey, current =>
          current?.map(flag => (flag.key === req.key ? previous : flag))
        );
      }
      pushNewSnackbar(
        APP_EVENTS.INFO.ADMIN.CANNOT_TOGGLE_FEATURE_FLAG,
        'error'
      );
    },

    onSuccess: () => {
      // Revalidate from server after successful mutation
      void queryClient.invalidateQueries({ queryKey: flagsKey });
      // DD3-F12: public feature-flag consumers must refresh too — admin toggle
      // affects what end users see (e.g. EXPLORE_ENABLED, BLOG_ENABLED).
      void queryClient.invalidateQueries({
        queryKey: queryKeys.public.featureFlags,
      });
    },
  });
}
