// main/src/UI/features/shared/gallery/hooks/useTogglePin.ts
// TQ v5 mutation -- toggles pin/unpin on a gallery record.
// Optimistic update on the detail query cache.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  galleryPinRecord_IO,
  galleryUnpinRecord_IO,
} from '../../../../../domain/gallery/galleryIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import type { getUserUsageStats_IO } from '../../../../../domain/user/userIO.possibilities.api';
import type { InfiniteData } from '@tanstack/react-query';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import type { PhotoDetailData } from './usePhotoDetail';

type GalleryListPage = GALLERY_DTO_API_V1['GET_GALLERY_RECORDS']['RESPONSE'];
type UsageStatsData = Awaited<ReturnType<typeof getUserUsageStats_IO>>;

/* --- Hook --- */

export function useTogglePin(galleryRecordId: string) {
  const queryClient = useQueryClient();
  const detailKey = queryKeys.gallery.byId(galleryRecordId);

  return useMutation({
    mutationFn: (isPinned: boolean) => {
      const req = { gallery_record_id: galleryRecordId };
      return isPinned ? galleryUnpinRecord_IO(req) : galleryPinRecord_IO(req);
    },
    meta: { suppressGlobalError: true },

    onMutate: async (isPinned: boolean) => {
      await queryClient.cancelQueries({ queryKey: detailKey });

      const snapshot = queryClient.getQueryData<PhotoDetailData>(detailKey);

      queryClient.setQueryData<PhotoDetailData>(detailKey, prev => {
        if (!prev) {
          return prev;
        }
        return { ...prev, is_pinned: !isPinned };
      });

      // Ta sama zmiana w KAŻDEJ załadowanej liście galerii (menedżer przypięć
      // na /app/profile, siatka /app/gallery). Bez tego kafel wracał do starego
      // stanu na czas round-tripu, bo lista czeka na invalidate z onSettled.
      const listSnapshots = queryClient.getQueriesData<
        InfiniteData<GalleryListPage>
      >({ queryKey: queryKeys.gallery.all });
      queryClient.setQueriesData<InfiniteData<GalleryListPage>>(
        { queryKey: queryKeys.gallery.all },
        prev => {
          if (!prev?.pages) {
            return prev;
          }
          return {
            ...prev,
            pages: prev.pages.map(page => ({
              ...page,
              records: page.records.map(record =>
                record.gallery_record_id === galleryRecordId
                  ? { ...record, is_pinned: !isPinned }
                  : record
              ),
            })),
          };
        }
      );

      // DECISION (nie usuwaj tego komentarza) — LICZNIK TEZ JEST OPTYMISTYCZNY:
      // kafel przelaczal sie natychmiast, ale `pinned_records` czekalo na
      // `invalidate` z `onSettled`, wiec przy suficie planu bramka `pinDisabled`
      // liczona z tego licznika byla przez caly round-trip o jeden do tylu —
      // uzytkowniczka mogla kliknac raz PONAD limit, dostac odmowe z serwera
      // i zobaczyc cofniety kafel. Serwer byl bezpieczny, ale UI obiecywal cos,
      // czego nie mial jak dowiezc. Migawka wraca w `onError` razem z reszta.
      const usageKey = queryKeys.account.usageStats;
      const usageSnapshot = queryClient.getQueryData<UsageStatsData>(usageKey);
      queryClient.setQueryData<UsageStatsData>(usageKey, prev =>
        prev === undefined
          ? prev
          : {
              ...prev,
              pinned_records: prev.pinned_records + (isPinned ? -1 : 1),
            }
      );

      return { snapshot, listSnapshots, usageSnapshot };
    },

    // Error toast owned by the HTTP interceptor (event-bus Stage 1): the backend
    // emits the specific pin failure (GALLERY_RECORD_ALREADY_PINNED /
    // GALLERY_PIN_LIMIT_REACHED / GALLERY_RECORD_OWNERSHIP_ERROR) or
    // INTERNET_CONNECTION_PROBLEM on network. A local push stacked a second toast
    // (different key never dedups) — this handler only rolls the pin state back.
    onError: (_err, _vars, context) => {
      if (context?.snapshot !== undefined) {
        queryClient.setQueryData<PhotoDetailData>(detailKey, context.snapshot);
      }
      context?.listSnapshots?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
      if (context?.usageSnapshot !== undefined) {
        queryClient.setQueryData<UsageStatsData>(
          queryKeys.account.usageStats,
          context.usageSnapshot
        );
      }
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: detailKey });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gallery.all,
      });
      // Licznik „przypięte X z Y" żyje w usage-stats (SSOT limitu planu), więc
      // musi odświeżyć się razem z listą — inaczej menedżer przypięć pokazuje
      // stary stosunek i przedwcześnie blokuje przypinanie.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.usageStats,
      });
    },
  });
}
