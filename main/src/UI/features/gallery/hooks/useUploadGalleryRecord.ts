// UI/features/gallery/hooks/useUploadGalleryRecord.ts
// Two-step upload: 1) Cloudinary vendor upload (image), 2) Create gallery record (metadata).
// Stack: TanStack Query v5.

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import posthog from 'posthog-js';
import {
  uploadImageToVendor_IO,
  createGalleryRecord_IO,
  deleteAssetByToken_IO,
} from '../../../../domain/gallery/galleryIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { reportIssueFrontend } from '../../../../application/error-debugger/errorHandler.possibilities.api';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';

/* --- Types --- */

export interface UploadGalleryPayload {
  file: File;
  color_ids: string[];
  trait_ids: string[];
  nail_length: NailLength;
}

/* --- Hook --- */

export function useUploadGalleryRecord() {
  const queryClient = useQueryClient();
  const [uploadProgress, setUploadProgress] = useState<
    'idle' | 'uploading' | 'saving' | 'done' | 'error'
  >('idle');

  // F3 draft-cancel: track the freshly uploaded Cloudinary asset so we can
  // discard it (client-side `delete_by_token`) if the user abandons the flow
  // before the gallery record is committed (Step 2). Refs (not state): we only
  // read these at unmount, no re-render needed.
  // - draftDeleteTokenRef: the `delete_token` from Step 1 (the discard authz).
  // - committedRef: Step 2 (createGalleryRecord) succeeded → asset is owned, keep.
  // - savingRef: Step 2 is in-flight → the record may yet be created, do NOT delete.
  // - abandonedDuringSaveRef: unmount fired while Step 2 was in-flight → the unmount
  //   cleanup could not delete (savingRef guard); the mutationFn `finally` finishes
  //   the discard once Step 2 settles to FAILED (closes the orphan-on-mid-save gap).
  // DECISION (nie usuwaj tego komentarza): `delete_token` jest opcjonalny (zalezy od
  // konfiguracji uploadu u dostawcy). Gdy go nie ma, sprzatanie szkicu jest no-opem,
  // a osierocony plik jest RAPORTOWANY, zeby dalo sie go pozniej pogodzic po `public_id`.
  const draftDeleteTokenRef = useRef<string | null>(null);
  const draftAssetUrlRef = useRef<string | null>(null);
  const committedRef = useRef(false);
  const savingRef = useRef(false);
  const abandonedDuringSaveRef = useRef(false);

  // Discard the freshly uploaded asset IFF it was never committed to a gallery
  // record and Step 2 is not mid-flight. Shared by unmount-cleanup, reset() and
  // the mutationFn finally. Defined BEFORE useMutation so the mutationFn closure
  // can call it (no use-before-define).
  // StrictMode/double-unmount guard: the token is nulled BEFORE firing, so a
  // second invocation is a no-op — delete_by_token is never POSTed twice for the
  // same asset. (React 18 dev double-mounts; the immediate cleanup runs while the
  // token is still null, so the real unmount later is unaffected.)
  // DECISION (nie usuwaj tego komentarza) — best-effort, ACCEPTED lost-ack risk
  // (cross-model review MEDIUM): jesli Step 2 createGalleryRecord zapisze rekord SERVER-SIDE
  // ale odpowiedz HTTP zginie (timeout/drop PO commitcie DB), klient widzi rejection ->
  // committedRef pozostaje false -> ten discard skasuje asset, ktory MA rekord w DB (broken
  // image). Okno = ~sekundy, nieodlaczne dla client-driven cleanup bez 2-phase/server-reconciliation.
  // SWIADOMIE akceptowane pre-launch (Cloudinary backend-cleanup B14 lapie wiekszosc create-fail
  // orphanow; docelowe zabezpieczenie = server orphan-sweep post-launch). NIE budujemy rozroznienia
  // 4xx-vs-timeout (over-eng dla ~sek okna). draft-cancel to NET-PLUS vs brak cleanupu (stan pre-PDH).
  const discardDraftIfUncommitted = () => {
    const token = draftDeleteTokenRef.current;
    if (committedRef.current || savingRef.current) {
      return;
    }
    if (!token) {
      const orphanUrl = draftAssetUrlRef.current;
      if (orphanUrl) {
        draftAssetUrlRef.current = null;
        reportIssueFrontend({
          namespace: 'UPLOAD_GALLERY_ORPHAN',
          message:
            'Porzucony plik nie został usunięty — brak delete_token',
          payload: { asset_url: orphanUrl, surface: 'galeria' },
          mode: 'warn',
        });
      }
      return;
    }
    draftDeleteTokenRef.current = null;
    draftAssetUrlRef.current = null;
    void deleteAssetByToken_IO(token);
  };

  const mutation = useMutation({
    mutationFn: async (
      payload: UploadGalleryPayload
    ): Promise<GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['RESPONSE']> => {
      // Step 1: Upload image to Cloudinary
      setUploadProgress('uploading');

      // Fresh run: discard any PREVIOUS uncommitted draft first (retry via mutateAsync
      // without reset() would otherwise overwrite the old delete_token and orphan it),
      // THEN reset tracking for this run.
      discardDraftIfUncommitted();
      committedRef.current = false;
      savingRef.current = false;
      abandonedDuringSaveRef.current = false;
      draftDeleteTokenRef.current = null;
      draftAssetUrlRef.current = null;

      // Skład FormData (preset, folder, flaga zdejmowania EXIF) i sam vendor-fetch
      // żyją w `uploadImageToVendor_IO` — jedno miejsce dla trzech powierzchni
      // uploadu (galeria, zdjęcie wizyty, zdjęcie profilowe). Odczyt
      // `delete_token ?? null` niżej obsługuje preset bez tej opcji.
      const cloudinaryResult = await uploadImageToVendor_IO(payload.file);

      // Lift the discard token: from now on, an unmount before Step 2 commits
      // will delete this freshly uploaded asset.
      draftDeleteTokenRef.current = cloudinaryResult.delete_token ?? null;
      draftAssetUrlRef.current = cloudinaryResult.secure_url;

      // Step 2: Create gallery record with metadata
      setUploadProgress('saving');
      savingRef.current = true;

      try {
        const result = await createGalleryRecord_IO({
          asset_url: cloudinaryResult.secure_url,
          color_ids: payload.color_ids,
          trait_ids: payload.trait_ids,
          nail_length: payload.nail_length,
        });

        // Record persisted — the asset is now owned by a gallery row, never discard it.
        committedRef.current = true;
        // Drop the discard token immediately: a committed asset must NEVER be deletable,
        // even after reset() ('Add another') later clears committedRef (cross-model review
        // HIGH — success -> reset -> abandon-before-new-file would otherwise let the unmount
        // cleanup discard the just-saved OWNED asset, leaving a broken-image DB row).
        draftDeleteTokenRef.current = null;
        // Ten sam powod dotyczy adresu: po commicie plik ma wlasciciela, wiec nie jest
        // juz sierota i nie wolno go raportowac jako wyciek. Czyszczone symetrycznie
        // z tokenem — inaczej `reset()` ('Dodaj kolejne') zostawialby zywy adres,
        // ktory przy nastepnym przebiegu poszedlby w FALSZYWE zgloszenie sieroty.
        draftAssetUrlRef.current = null;
        setUploadProgress('done');
        return result;
      } finally {
        savingRef.current = false;
        // If the user unmounted mid-save, the unmount cleanup deferred the discard
        // (savingRef was true). Now that Step 2 settled: if it did NOT commit
        // (it threw), discard the orphaned asset here — the component is already
        // gone, so this finally is the last chance to clean up.
        if (abandonedDuringSaveRef.current && !committedRef.current) {
          discardDraftIfUncommitted();
        }
      }
    },
    meta: { suppressGlobalError: true },

    onSuccess: (_data, variables) => {
      // Składnik aktywacji (SSOT §8.3: ≥3 zdjęcia + QR) — semantyczny event
      // funnela D0 w PostHog obok EventLogowego GALLERY_RECORD_CREATED
      // (backend). Krok „3. zdjęcie" liczy się po stronie PostHog (count per
      // user). Singleton respektuje opt-out; nail_length = enum, zero PII.
      posthog.capture('gallery_photo_uploaded', {
        nail_length: variables.nail_length,
      });
    },

    onError: () => {
      setUploadProgress('error');
    },

    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gallery.all,
      });
      // DD3-F12: dashboard "First photo" / activity feed reflects new upload
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.dashboardFeed,
      });
      // DD2-H2: usage bar (photo count vs limit) must reflect upload immediately
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.usageStats,
      });
    },
  });

  // Draft-cancel on unmount: if the stylist navigates away after Step 1 but
  // before the record commits, the orphaned Cloudinary asset is deleted. If Step 2
  // is mid-flight, the discard is deferred to the mutationFn `finally` (which fires
  // after Step 2 settles) via abandonedDuringSaveRef — the cleanup itself cannot
  // delete now without risking a committed asset.
  useEffect(() => {
    return () => {
      abandonedDuringSaveRef.current = true;
      discardDraftIfUncommitted();
    };
  }, []);

  const reset = () => {
    // "Add another" / retry: drop the previous run's asset if it was abandoned
    // (uploaded but never committed). A committed asset is preserved by the guard.
    discardDraftIfUncommitted();
    committedRef.current = false;
    savingRef.current = false;
    abandonedDuringSaveRef.current = false;
    setUploadProgress('idle');
    mutation.reset();
  };

  return {
    ...mutation,
    uploadProgress,
    reset,
  };
}
