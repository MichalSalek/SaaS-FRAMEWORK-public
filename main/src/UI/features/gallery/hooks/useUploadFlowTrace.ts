// UI/features/gallery/hooks/useUploadFlowTrace.ts
// Named analytics trace of „Dodaj stylizację” (flow `upload`), kept beside the
// wizard state so the state hook stays within its size budget. Steps that
// follow state (photo chosen, crop done, details shown, left unpublished) are
// read from that state; `source_chosen` fires on the tap in UploadSourceZone,
// `published` / `failed` in useUploadGalleryRecord. Facts only (source, step),
// never the photo or its tags.

import { useEffect, useRef, type ChangeEvent, type DragEvent } from 'react';
import { trackFlowStep } from '../../../../application/analytics/flow-events';
import type {
  UploadGalleryPayload,
  UploadSource,
  useUploadGalleryRecord,
} from './useUploadGalleryRecord';

type UploadMutation = ReturnType<typeof useUploadGalleryRecord>;

export function useUploadFlowTrace(
  step: number,
  selectedFile: File | null,
  croppedFile: File | null,
  upload: UploadMutation
) {
  const startedRef = useRef(false);
  const sourceRef = useRef<UploadSource>('library');
  const lastFileRef = useRef<File | null>(null);
  const lastCropRef = useRef<File | null>(null);
  const detailsViewedRef = useRef(false);
  const stepRef = useRef(step);
  // A photo was chosen and is not published yet (read at unmount).
  const hasDraftRef = useRef(false);
  const progress = upload.uploadProgress;

  // Once per page instance; the ref survives the StrictMode re-run.
  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      trackFlowStep('upload', 'started');
    }
  }, []);

  // Keyed to the file object: a re-run of the effect never counts it twice.
  useEffect(() => {
    if (selectedFile && lastFileRef.current !== selectedFile) {
      lastFileRef.current = selectedFile;
      detailsViewedRef.current = false;
      trackFlowStep('upload', 'photo_selected', { source: sourceRef.current });
    }
  }, [selectedFile]);

  useEffect(() => {
    if (croppedFile && lastCropRef.current !== croppedFile) {
      lastCropRef.current = croppedFile;
      trackFlowStep('upload', 'cropped');
    }
  }, [croppedFile]);

  useEffect(() => {
    stepRef.current = step;
    if (step === 2 && !detailsViewedRef.current) {
      detailsViewedRef.current = true;
      trackFlowStep('upload', 'details_viewed');
    }
  }, [step]);

  useEffect(() => {
    hasDraftRef.current = selectedFile !== null && progress !== 'done';
  }, [selectedFile, progress]);

  // Leaving with a chosen photo that never got published. The StrictMode
  // re-run of this cleanup happens on mount, before any photo exists.
  useEffect(() => {
    return () => {
      if (hasDraftRef.current) {
        hasDraftRef.current = false;
        trackFlowStep('upload', 'abandoned', { step: stepRef.current });
      }
    };
  }, []);

  return {
    /** Only the camera input carries `capture` (UploadSourceZone). */
    fromInput:
      (handler: (event: ChangeEvent<HTMLInputElement>) => void) =>
      (event: ChangeEvent<HTMLInputElement>) => {
        sourceRef.current = event.target.hasAttribute('capture')
          ? 'camera'
          : 'library';
        handler(event);
      },
    fromDrop:
      (handler: (event: DragEvent<HTMLElement>) => void) =>
      (event: DragEvent<HTMLElement>) => {
        sourceRef.current = 'drop';
        handler(event);
      },
    retrying: (handler: () => void) => () => {
      trackFlowStep('upload', 'retried');
      handler();
    },
    /** The mutation carries the source so `published` can report it. */
    publish: (payload: UploadGalleryPayload) =>
      upload.mutateAsync({ ...payload, source: sourceRef.current }),
  };
}
