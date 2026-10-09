// UI/features/account/hooks/useUploadAvatar.ts
// Zdjęcie profilowe stylistki: dwukrokowy zapis (1. plik do chmury, 2. adres do
// naszego API) plus usunięcie, które oddaje profil fallbackowi (obraz z OAuth →
// inicjały). Ten sam kształt co upload zdjęcia stylizacji i zdjęcia efektu wizyty.

import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  deleteAssetByToken_IO,
  uploadImageToVendor_IO,
} from '../../../../domain/gallery/galleryIO.possibilities.api';
import { setAccountAvatar_IO } from '../../../../domain/account/accountIO.possibilities.api';
import { reportIssueFrontend } from '../../../../application/error-debugger/errorHandler.possibilities.api';
import { invalidateStylistProfileCaches } from '../helpers/invalidate-stylist-profile.helper';

export function useUploadAvatar() {
  const queryClient = useQueryClient();

  // Porzucony wgrany plik (krok 1 przeszedł, krok 2 nie) kasujemy z chmury
  // tokenem zwróconym przez dostawcę. Refy, nie stan: czytamy je przy odmontowaniu
  // i nie chcemy przerysowania. Pełna mechanika i jej granice — DECISION przy
  // `discardDraftIfUncommitted` w useUploadGalleryRecord.
  // DECISION (nie usuwaj tego komentarza): `delete_token` jest opcjonalny (zalezy od
  // konfiguracji uploadu u dostawcy). Gdy go nie ma, sprzatanie szkicu jest no-opem,
  // a osierocony plik jest RAPORTOWANY, zeby dalo sie go pozniej pogodzic po `public_id`.
  const draftDeleteTokenRef = useRef<string | null>(null);
  const draftAssetUrlRef = useRef<string | null>(null);
  const committedRef = useRef(false);
  const savingRef = useRef(false);
  const abandonedDuringSaveRef = useRef(false);

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
          namespace: 'UPLOAD_AVATAR_ORPHAN',
          message:
            'Porzucony plik nie został usunięty — brak delete_token',
          payload: { asset_url: orphanUrl, surface: 'avatar' },
          mode: 'warn',
        });
      }
      return;
    }
    draftDeleteTokenRef.current = null;
    draftAssetUrlRef.current = null;
    void deleteAssetByToken_IO(token);
  };

  const upload = useMutation({
    mutationFn: async (file: File) => {
      // Nowy przebieg porzuca ewentualny poprzedni szkic, ZANIM nadpisze token.
      discardDraftIfUncommitted();
      committedRef.current = false;
      savingRef.current = false;
      abandonedDuringSaveRef.current = false;
      draftDeleteTokenRef.current = null;
      draftAssetUrlRef.current = null;

      const cloudinaryResult = await uploadImageToVendor_IO(file);
      draftDeleteTokenRef.current = cloudinaryResult.delete_token ?? null;
      draftAssetUrlRef.current = cloudinaryResult.secure_url;
      savingRef.current = true;

      try {
        const result = await setAccountAvatar_IO({
          avatar_url: cloudinaryResult.secure_url,
        });
        // Plik ma właściciela w bazie — od tej chwili NIGDY go nie kasujemy,
        // nawet jeśli użytkowniczka zaraz wyjdzie z ekranu.
        committedRef.current = true;
        draftDeleteTokenRef.current = null;
        draftAssetUrlRef.current = null;
        return result;
      } finally {
        savingRef.current = false;
        if (abandonedDuringSaveRef.current && !committedRef.current) {
          discardDraftIfUncommitted();
        }
      }
    },
    // Warstwa 3 (globalny fallback) wyłączona: błąd kroku 2 toastuje interceptor
    // (event backendu), a błąd kroku 1 obsługuje wołający — vendor-fetch omija
    // interceptor, więc bez tego byłby całkowicie niemy (S82).
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      invalidateStylistProfileCaches(queryClient);
    },
  });

  const remove = useMutation({
    mutationFn: () => setAccountAvatar_IO({ avatar_url: null }),
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      invalidateStylistProfileCaches(queryClient);
    },
  });

  useEffect(() => {
    return () => {
      abandonedDuringSaveRef.current = true;
      discardDraftIfUncommitted();
    };
  }, []);

  return { upload, remove };
}
