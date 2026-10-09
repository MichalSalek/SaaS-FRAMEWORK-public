// main/src/UI/features/admin/hooks/useAdminNotes.ts
// TQ v5 query — GET /api/v1/admin/get-notes
// Stack: TQ v5 queryOptions pattern (SSOT MIG-B1).

import { queryOptions, useQuery } from '@tanstack/react-query';
import { getNotes_IO } from '../../../../domain/admin/users/adminUsersIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

/* ─── Types ─── */

type AdminNotesResponse = ADMIN_DTO_API_V1['GET_NOTES']['RESPONSE'];
export type AdminNoteVersion = AdminNotesResponse['versions'][0];

/* ─── Fetcher ─── */

const fetchNotes = getNotes_IO;

/* ─── Query options (reusable — prefetch-compatible) ─── */

const adminNotesQueryOptions = queryOptions({
  queryKey: queryKeys.admin.notes,
  queryFn: ({ signal }) => fetchNotes({}, { signal }),
  staleTime: 30_000,
});

/* ─── Hook ─── */

export function useAdminNotes() {
  const { data, isLoading, isFetching, isError, refetch } = useQuery(
    adminNotesQueryOptions
  );

  return {
    notes: data?.versions ?? null,
    currentMainNotes: data?.notes ?? null,
    isLoading,
    isFetching,
    isError,
    refetch,
  };
}

/* ─── Per-version content query ─── */

// DECISION (nie usuwaj tego komentarza):
// Lista wersji (`versions`) z GET_NOTES jest metadata-only (id/created_at/length,
// BEZ treści — patrz admin-notes.dto.ts). Treść KONKRETNEJ wersji rozstrzyga
// backend przez requestedId (`getNotes_IO({ id })` → DECISION admin-notes-3),
// zwracając ją w polu `notes`. Dlatego edytor pobiera treść wybranej wersji
// osobnym zapytaniem, keyowanym po id (prefix queryKeys.admin.notes → mutacje
// save/set-main inwalidują też te per-wersyjne wpisy).
const adminNoteVersionContentQueryOptions = (id: string) =>
  queryOptions({
    queryKey: [...queryKeys.admin.notes, id] as const,
    queryFn: ({ signal }) => fetchNotes({ id }, { signal }),
    staleTime: 30_000,
  });

export function useAdminNoteVersionContent(id: string | null) {
  const { data, isFetching, isError, refetch } = useQuery({
    ...adminNoteVersionContentQueryOptions(id ?? ''),
    enabled: id !== null,
  });

  return {
    versionContent: id !== null ? (data?.notes ?? null) : null,
    isFetchingContent: id !== null && isFetching,
    isContentError: id !== null && isError,
    refetchContent: refetch,
  };
}
