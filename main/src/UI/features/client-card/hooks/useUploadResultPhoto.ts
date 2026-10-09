import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
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

      // Skład FormData i vendor-fetch: `uploadImageToVendor_IO` (jedno miejsce dla
      // wszystkich powierzchni uploadu); odczyt delete_token niżej obsługuje brak.
      // S82: błąd Step 1 (raw vendor-fetch do Cloudinary) był CAŁKOWICIE niemy —
      // suppressGlobalError wyłącza warstwę 3, a interceptor (warstwa 1) nie
      // widzi vendor-fetcha. Toast TYLKO tutaj: błąd Step 2 (nasze API) toastuje
      // już interceptor, a wcześniejszy onError na całej mutacji dokładał drugi
      // toast, i to z copy galerii („kadr i tagi zostały zachowane"), które w
      // karcie wizyty nie było prawdą.
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
