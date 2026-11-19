import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { trackFlowStep } from '../../../../application/analytics/flow-events';
import {
  deleteAssetByToken_IO,
  uploadImageToVendor_IO,
} from '../../../../domain/gallery/galleryIO.possibilities.api';
import { addVisitResultPhoto_IO } from '../../../../domain/visit/visitIO.possibilities.api';

export function useUploadResultPhoto(clientUserId: string) {
  const queryClient = useQueryClient();
  const t = useTranslations('clientCard');
  const draftDeleteTokenRef = useRef<string | null>(null);
  const committedRef = useRef(false);
  const savingRef = useRef(false);
  const abandonedDuringSaveRef = useRef(false);

  const discardDraftIfUncommitted = () => {
    const token = draftDeleteTokenRef.current;
    if (!token || committedRef.current || savingRef.current) {
      return;
    }
    draftDeleteTokenRef.current = null;
    void deleteAssetByToken_IO(token);
  };

  const mutation = useMutation({
    mutationFn: async ({ visitId, file }: { visitId: string; file: File }) => {
      discardDraftIfUncommitted();
      committedRef.current = false;
      savingRef.current = false;
      abandonedDuringSaveRef.current = false;
      draftDeleteTokenRef.current = null;

      // FormData assembly and vendor fetch: `uploadImageToVendor_IO` (one place for all upload
      // surfaces); reading delete_token below handles its absence.
      // A Step 1 error (raw vendor fetch to Cloudinary) was COMPLETELY silent — suppressGlobalError
      // turns off layer 3, and the interceptor (layer 1) does not see the vendor fetch. Toast ONLY
      // here: a Step 2 error (our API) is already toasted by the interceptor, and an earlier onError
      // on the whole mutation added a second toast, with gallery copy („kadr i tagi zostały
      // zachowane") that was not true on a visit card.
      let cloudinaryResult: Awaited<ReturnType<typeof uploadImageToVendor_IO>>;
      try {
        cloudinaryResult = await uploadImageToVendor_IO(file);
      } catch (error) {
        pushNewSnackbar(t('resultPhotoUploadFailed'), 'error');
        throw error;
      }
      draftDeleteTokenRef.current = cloudinaryResult.delete_token ?? null;
      savingRef.current = true;

      try {
        const result = await addVisitResultPhoto_IO({
          visit_id: visitId,
          asset_url: cloudinaryResult.secure_url,
        });
        committedRef.current = true;
        draftDeleteTokenRef.current = null;
        return result;
      } finally {
        savingRef.current = false;
        if (abandonedDuringSaveRef.current && !committedRef.current) {
          discardDraftIfUncommitted();
        }
      }
    },
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      trackFlowStep('client_card', 'visit_edited', { change: 'photo_added' });
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.client.visits(clientUserId),
      }),
  });

  useEffect(() => {
    return () => {
      abandonedDuringSaveRef.current = true;
      discardDraftIfUncommitted();
    };
  }, []);

  return mutation;
}
