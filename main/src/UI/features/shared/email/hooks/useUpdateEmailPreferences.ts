// UI/features/shared/email/hooks/useUpdateEmailPreferences.ts
// TQ v5 mutation -- POST /api/v1/email/update-preferences (STYLIST only).
// Optimistic toggle on `account.current.email_preferences`. Rollback on error.
// Shared (features/shared): used by account settings (EmailPrefsSection) AND the
// gallery marketing-catch (useMarketingCatch) — cross-feature, so it lives here.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateEmailPreferences_IO } from '../../../../../domain/email/emailIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import type {
  EMAIL_DTO_API_V1,
  EmailPreferences,
} from '@kernel/models/email/email.dto';
import type { SafeCurrentUser } from '@kernel/models/session/session.dto';

/* ─── Types ─── */

type EmailPrefsRequest =
  EMAIL_DTO_API_V1['EMAIL_UPDATE_PREFERENCES']['REQUEST'];

interface MutationContext {
  snapshot: SafeCurrentUser | undefined;
}

/* ─── Hook ─── */

/**
 * Optimistic update: `email_preferences` flips on the `account.current` cache
 * before the network round-trip. On error -> snapshot rollback. On settled ->
 * invalidate to reconcile with server.
 *
 * `transactional` is always `true` server-side (PKE compliance) and is never
 * touched here.
 */
export function useUpdateEmailPreferences() {
  const queryClient = useQueryClient();
  const cacheKey = queryKeys.account.current;

  return useMutation<
    EMAIL_DTO_API_V1['EMAIL_UPDATE_PREFERENCES']['RESPONSE'],
    Error,
    EmailPrefsRequest,
    MutationContext
  >({
    mutationFn: req => updateEmailPreferences_IO(req),
    meta: { suppressGlobalError: true },

    onMutate: async req => {
      await queryClient.cancelQueries({ queryKey: cacheKey });
      const snapshot = queryClient.getQueryData<SafeCurrentUser>(cacheKey);

      queryClient.setQueryData<SafeCurrentUser>(cacheKey, prev => {
        if (!prev || !prev.stylist_account) {
          return prev;
        }
        const nextPrefs: EmailPreferences = {
          trial_sequence: req.trial_sequence,
          marketing: req.marketing,
        };
        return {
          ...prev,
          stylist_account: {
            ...prev.stylist_account,
            email_preferences: nextPrefs,
          },
        };
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
