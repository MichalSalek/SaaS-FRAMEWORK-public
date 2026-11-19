// UI/features/gallery/hooks/useUploadGalleryRecord.ts
// Two-step upload: 1) Cloudinary vendor upload (image), 2) Create gallery record (metadata).
// Stack: TanStack Query v5.

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { capturePosthog } from '../../../../application/analytics/posthog-client';
import {
  uploadImageToVendor_IO,
  createGalleryRecord_IO,
  deleteAssetByToken_IO,
} from '../../../../domain/gallery/galleryIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { reportIssueFrontend } from '../../../../application/error-debugger/errorHandler.possibilities.api';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import type { getUserUsageStats_IO } from '../../../../domain/user/userIO.possibilities.api';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import { trackFlowStep } from '../../../../application/analytics/flow-events';
import { flowErrorCode } from '../../shared/analytics/flowErrorCode';
import { authClient } from '../../../../application/auth/better-auth-client';
import {
  galleryUploadIdentity,
  sameGalleryUploadIdentity,
  GalleryUploadIdentityChanged,
} from './gallery-upload-identity';

/* --- Types --- */

/** Where the photo came from: the camera button, the phone picker or a drop. */
export type UploadSource = 'camera' | 'library' | 'drop';

export interface UploadGalleryPayload {
  file: File;
  color_ids: string[];
  trait_ids: string[];
  nail_length: NailLength;
  /** Analytics fact only (where the photo came from); never sent to the API. */
  source?: UploadSource;
}

/* --- Hook --- */

export function useUploadGalleryRecord() {
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [uploadProgress, setUploadProgress] = useState<
    'idle' | 'uploading' | 'saving' | 'done' | 'error'
  >('idle');

  // Draft cancel: track the freshly uploaded Cloudinary asset so it can be discarded
  // (`delete_by_token`) if the flow is abandoned before Step 2. Refs: read only at unmount.
  // - draftDeleteTokenRef: the `delete_token` from Step 1 (the discard authz).
  // - committedRef: Step 2 (createGalleryRecord) succeeded → the asset is owned, keep.
  // - savingRef: Step 2 is in flight → the record may yet be created, do NOT delete.
  // - abandonedDuringSaveRef: unmount fired mid-Step 2, so the `finally` of the
  //   mutationFn finishes the discard once Step 2 settles to FAILED.
  // DECISION: the orphan cleanup is currently a NO-OP, and that must stay visible. Cloudinary
  // returns `delete_token` only when the upload preset (`ml_default`, unsigned) has "Return delete
  // token" enabled; it is not, so `draftDeleteTokenRef` stays `null` and a file uploaded in step 1
  // stays in the cloud when step 2 fails. The front cannot fix it (deleting without a token needs
  // signed data) and the backend `deleteAssetFromVendor_IO` REQUIRES an existing galleryRecord row
  // (see the DECISION in gallery-asset.operations). So the orphan is REPORTED and can be reconciled
  // by `public_id`. Owner switch: Cloudinary > Upload presets > `ml_default` > "Return delete
  // token" ON; then this code comes alive with no repo change.
  const draftDeleteTokenRef = useRef<string | null>(null);
  const draftAssetUrlRef = useRef<string | null>(null);
  const committedRef = useRef(false);
  const savingRef = useRef(false);
  const abandonedDuringSaveRef = useRef(false);

  // Discard the freshly uploaded asset IFF it was never committed to a gallery
  // record and Step 2 is not mid-flight. Shared by unmount-cleanup, reset() and
  // the mutationFn finally. Defined BEFORE useMutation so the mutationFn closure
  // can call it (no use-before-define).
  // StrictMode/double-unmount guard: the token is nulled BEFORE firing, so a second invocation
  // finds no token and returns (no test pins this; it is the mechanism, not a proven guarantee).
  // React 18 dev double-mounts; the immediate cleanup runs while the token is still null, so the
  // real unmount later is unaffected.
  // DECISION: best-effort with an ACCEPTED lost-ack risk. If step 2 createGalleryRecord saves the
  // record SERVER-SIDE but the HTTP response is lost (after the DB commit), the client sees a
  // rejection, committedRef stays false and the discard deletes an asset that HAS a DB record (a
  // broken image). The window is ~seconds and inseparable from client-driven cleanup without
  // server reconciliation; the target safeguard is a server orphan sweep post-launch. We do NOT
  // build a 4xx-vs-timeout distinction for it; the draft cancel is a net plus over no cleanup.
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
          message: 'Porzucony plik nie został usunięty — brak delete_token',
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
    ): Promise<{
      record: GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['RESPONSE'];
      isCurrent: () => boolean;
    }> => {
      const identity = galleryUploadIdentity(queryClient, sessionRef.current);
      if (!identity) {
        throw new Error('Gallery upload identity is unverified');
      }
      const isCurrent = () =>
        sameGalleryUploadIdentity(
          identity,
          galleryUploadIdentity(queryClient, sessionRef.current)
        );
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

      // The FormData (preset, folder, EXIF-strip flag) and the vendor fetch live in
      // `uploadImageToVendor_IO`, one place for three upload surfaces (gallery, visit
      // photo, profile photo). `delete_token ?? null` below handles a preset without
      // that option.
      const cloudinaryResult = await uploadImageToVendor_IO(payload.file);

      // Lift the discard token: from now on, an unmount before Step 2 commits
      // will delete this freshly uploaded asset.
      draftDeleteTokenRef.current = cloudinaryResult.delete_token ?? null;
      draftAssetUrlRef.current = cloudinaryResult.secure_url;
      if (!isCurrent()) {
        discardDraftIfUncommitted();
        throw new GalleryUploadIdentityChanged(
          'Gallery upload identity changed'
        );
      }

      // Step 2: Create gallery record with metadata
      setUploadProgress('saving');
      savingRef.current = true;

      try {
        const result = await createGalleryRecord_IO(
          {
            asset_url: cloudinaryResult.secure_url,
            color_ids: payload.color_ids,
            trait_ids: payload.trait_ids,
            nail_length: payload.nail_length,
          },
          { silentBusinessError: true }
        );

        // Record persisted — the asset is now owned by a gallery row, never discard it.
        committedRef.current = true;

        draftDeleteTokenRef.current = null;
        // Ten sam powod dotyczy adresu: po commicie plik ma wlasciciela, wiec nie jest
        // juz sierota i nie wolno go raportowac jako wyciek. Czyszczone symetrycznie
        // z tokenem — inaczej `reset()` ('Dodaj kolejne') zostawialby zywy adres,
        // ktory przy nastepnym przebiegu poszedlby w FALSZYWE zgloszenie sieroty.
        draftAssetUrlRef.current = null;
        setUploadProgress(isCurrent() ? 'done' : 'idle');
        return { record: result, isCurrent };
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

    onSuccess: ({ isCurrent }, variables) => {
      if (!isCurrent()) {
        return;
      }
      // Confirmed persistence advances the known count immediately. A fast
      // "Add another" must not reuse the previous ordinal before refetch settles.
      const usage = queryClient.setQueryData<
        Awaited<ReturnType<typeof getUserUsageStats_IO>>
      >(queryKeys.account.usageStats, previous =>
        previous
          ? { ...previous, gallery_records: previous.gallery_records + 1 }
          : previous
      );
      trackFlowStep('upload', 'published', {
        source: variables.source,
        ordinal: usage?.gallery_records,
      });
      // Activation ingredient (SSOT §8.3: ≥3 photos + QR): a semantic D0 funnel
      // event in PostHog next to the backend EventLog GALLERY_RECORD_CREATED. The
      // „3rd photo" step is counted on the PostHog side (count per user). The
      // singleton honours opt-out; nail_length is an enum, no PII.
      capturePosthog('gallery_photo_uploaded', {
        nail_length: variables.nail_length,
      });
    },

    onError: error => {
      if (error instanceof GalleryUploadIdentityChanged) {
        setUploadProgress('idle');
        return;
      }
      setUploadProgress('error');
      // A non-IO throw is step 1 (the direct Cloudinary upload).
      trackFlowStep('upload', 'failed', {
        code: flowErrorCode(error, 'vendor_upload'),
      });
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
    data: mutation.data?.isCurrent() ? mutation.data.record : undefined,
    uploadProgress,
    reset,
  };
}
