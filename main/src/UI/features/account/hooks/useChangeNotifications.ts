// UI/features/account/hooks/useChangeNotifications.ts
// TQ v5 mutation -- POST /api/v1/user/update-notification-preferences
// Optimistic toggle: UI flips immediately; rollback on error.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateNotificationPreferences_IO } from '../../../../domain/user/userIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import type { SafeCurrentUser } from '@kernel/models/session/session.dto';

/* ─── Types ─── */

type NotificationsRequest =
  USER_DTO_API_V1['USER_UPDATE_NOTIFICATION_PREFERENCES']['REQUEST'];

// `account.current` przechowuje SafeCurrentUser (sesja BEZ tokena/userId) — ten
// sam typ, którym czyta go siostrzany useChangeName. Generyk CurrentUser dawał
// TS-owi prawo do pól, których runtime nigdy tu nie zwraca.
interface MutationContext {
  snapshot: SafeCurrentUser | undefined;
}

/* ─── Hook ─── */

/**
 * Optimistic update on the `account.current` cache so the toggle flips
 * instantly. Rollback to snapshot on error. Refetch on settled to sync with
 * server truth.
 */
export function useChangeNotifications() {
  const queryClient = useQueryClient();
  const cacheKey = queryKeys.account.current;

  return useMutation<
    USER_DTO_API_V1['USER_UPDATE_NOTIFICATION_PREFERENCES']['RESPONSE'],
    Error,
    NotificationsRequest,
    MutationContext
  >({
    mutationFn: req => updateNotificationPreferences_IO(req),
    meta: { suppressGlobalError: true },

    onMutate: async req => {
      await queryClient.cancelQueries({ queryKey: cacheKey });
      const snapshot = queryClient.getQueryData<SafeCurrentUser>(cacheKey);

      queryClient.setQueryData<SafeCurrentUser>(cacheKey, prev => {
        if (!prev) {
          return prev;
        }
        return { ...prev, notifications_enabled: req.notifications_enabled };
      });

      return { snapshot };
    },

    onError: (_err, _req, context) => {
      if (context?.snapshot !== undefined) {
        queryClient.setQueryData<SafeCurrentUser>(cacheKey, context.snapshot);
      }
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: cacheKey });
    },
  });
}
