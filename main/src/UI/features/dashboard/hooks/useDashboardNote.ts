import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { AccountType } from '@kernel/models/db_models.generated.dto';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import {
  getDashboardNote_IO,
  setDashboardNote_IO,
} from '../../../../domain/account/accountIO.possibilities.api';

const DEFER_MS = 1000;

/* --- Hook --- */

export function useDashboardNote(accountType: AccountType) {
  const queryClient = useQueryClient();
  const t = useTranslations('dashboard.note');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), DEFER_MS);
    return () => clearTimeout(timer);
  }, []);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: queryKeys.account.dashboardNote,
    queryFn: ({ signal }) => getDashboardNote_IO(undefined, { signal }),
    staleTime: 60_000,
    enabled: ready,
  });

  const note =
    accountType === AccountTypeValue.STYLIST
      ? (data?.stylist_note ?? null)
      : (data?.client_note ?? null);

  const mutation = useMutation({
    mutationFn: (newNote: string | null) =>
      setDashboardNote_IO({ note: newNote, account_type: accountType }),
    meta: { suppressGlobalError: true },

    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.account.dashboardNote,
      });
    },
    onError: () => {
      pushNewSnackbar(t('saveError'), 'error');
    },
  });

  return {
    note,
    isLoading: !ready || isLoading,
    // The note could not be read and nothing is cached. `note` is then null
    // for "unknown", NOT "empty": rendering it as an empty editable field let
    // the user type over a note that exists on the server, and the autosave
    // overwrote it.
    loadFailed: ready && isError && data === undefined,
    retryLoad: () => void refetch(),
    isRetrying: isFetching,
    saveNote: mutation.mutate,
    saveNoteAsync: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}
