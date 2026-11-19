// UI/features/account/hooks/useUploadAvatar.ts
// Stylist profile photo: a two-step save (1. file to the cloud, 2. address to our API) plus a
// removal that hands the profile back to the fallback (OAuth image → initials). Same shape as the
// styling photo upload and the visit result photo.

import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  deleteAssetByToken_IO,
  uploadImageToVendor_IO,
} from '../../../../../domain/gallery/galleryIO.possibilities.api';
import { setUserAvatar_IO } from '../../../../../domain/user/userIO.possibilities.api';
import { setSalonLogo_IO } from '../../../../../domain/salon-profile/salonProfileIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import type { SafeCurrentUserWire } from '@kernel/domain/user/user.contract-schemas';
import type { SalonProfileData } from '@kernel/models/salon-profile/salon-profile.dto';
import { reportIssueFrontend } from '../../../../../application/error-debugger/errorHandler.possibilities.api';
import { invalidateStylistProfileCaches } from '../invalidate-stylist-profile.helper';
import { trackFlowStep } from '../../../../../application/analytics/flow-events';
import { flowErrorCode } from '../../analytics/flowErrorCode';
import { authClient } from '../../../../../application/auth/better-auth-client';
import { getFromClientStorage } from '../../../../../application/client-device-storage/clientStorage.possibilities.api';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { useTranslations } from 'next-intl';
import { pushNewSnackbar } from '../../../../../application/app-snackbar/appSnackbar.possibilities.api';

class UnverifiedProfileIdentity extends Error {}

type UploadIdentity = {
  userId: string;
  accountId: string | null;
  token: string;
  becomeUser: string | null;
};

export function useUploadAvatar(target: 'person' | 'logo' = 'person') {
  const queryClient = useQueryClient();
  const tOutcome = useTranslations('components.outcomeFeedback');
  const session = authClient.useSession();
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const currentIdentity = (): UploadIdentity | null => {
    const token = getFromClientStorage({ key: CUSTOM_HEADERS.authorization });
    const becomeUser = getFromClientStorage({ key: CUSTOM_HEADERS.becomeUser });
    const current = queryClient.getQueryData<SafeCurrentUserWire>(
      queryKeys.account.current
    );
    const active = sessionRef.current;
    if (
      !token ||
      active.isPending ||
      active.error ||
      !current?.id ||
      active.data?.user?.id !== current.id
    ) {
      return null;
    }
    const accountId = current.stylist_account?.account_id ?? null;
    if (
      target === 'logo' &&
      (!accountId ||
        queryClient.getQueryData<SalonProfileData>(queryKeys.salon.mine)
          ?.account_id !== accountId)
    ) {
      return null;
    }
    return { userId: current.id, accountId, token, becomeUser };
  };
  const matchesIdentity = (identity: UploadIdentity): boolean => {
    const now = currentIdentity();
    return (
      now !== null &&
      now.userId === identity.userId &&
      now.accountId === identity.accountId &&
      now.token === identity.token &&
      now.becomeUser === identity.becomeUser
    );
  };

  // A draft abandoned before the profile request is sent can be deleted using
  // the vendor token. Refs are read at unmount and need no re-render.
  // DECISION: the cleanup is a no-op until the upload preset returns delete tokens; mechanism and
  // the owner switch: main/src/UI/features/gallery/hooks/useUploadGalleryRecord.ts.
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
            'Porzucony plik zostaje w chmurze — preset nie zwraca delete_token',
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
      const identity = currentIdentity();
      if (!identity) {
        throw new UnverifiedProfileIdentity('Profile identity is unverified');
      }
      // A new run abandons any previous draft BEFORE it overwrites the token.
      discardDraftIfUncommitted();
      committedRef.current = false;
      savingRef.current = false;
      abandonedDuringSaveRef.current = false;
      draftDeleteTokenRef.current = null;
      draftAssetUrlRef.current = null;

      const cloudinaryResult = await uploadImageToVendor_IO(file);
      draftDeleteTokenRef.current = cloudinaryResult.delete_token ?? null;
      draftAssetUrlRef.current = cloudinaryResult.secure_url;
      if (!matchesIdentity(identity)) {
        discardDraftIfUncommitted();
        throw new Error('Profile identity changed');
      }
      savingRef.current = true;

      try {
        const result =
          target === 'person'
            ? await setUserAvatar_IO({
                avatar_url: cloudinaryResult.secure_url,
              })
            : await setSalonLogo_IO({ logo_url: cloudinaryResult.secure_url });
        // The file has an owner in the DB; from now on we NEVER delete it, even if the user leaves the
        // screen right away.
        committedRef.current = true;
        draftDeleteTokenRef.current = null;
        draftAssetUrlRef.current = null;
        // Keep credentials out of the mutation result exposed by the query cache.
        return { result, isCurrent: () => matchesIdentity(identity) };
      } catch (error) {
        // The request may have committed even when its response was lost. Its
        // delete token must not be used against a possibly referenced image.
        draftDeleteTokenRef.current = null;
        draftAssetUrlRef.current = null;
        throw error;
      } finally {
        savingRef.current = false;
        if (abandonedDuringSaveRef.current && !committedRef.current) {
          discardDraftIfUncommitted();
        }
      }
    },
    // Layer 3 (global fallback) is off: a step 2 error is toasted by the interceptor (backend event),
    // and a step 1 error is handled by the caller; the vendor fetch bypasses the interceptor, so
    // without this it would be completely silent.
    meta: { suppressGlobalError: true },
    onSuccess: ({ result, isCurrent }) => {
      if (!isCurrent()) {
        return;
      }
      if ('user_id' in result) {
        queryClient.setQueryData<SafeCurrentUserWire>(
          queryKeys.account.current,
          current =>
            current ? { ...current, avatar_url: result.avatar_url } : current
        );
      } else {
        queryClient.setQueryData<SalonProfileData>(
          queryKeys.salon.mine,
          current =>
            current ? { ...current, logo_url: result.logo_url } : current
        );
        void queryClient.invalidateQueries({
          queryKey: [queryKeys.salon.mine[0], 'public'],
        });
      }
      void queryClient.invalidateQueries({
        queryKey: [queryKeys.salon.mine[0], 'public'],
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.staff.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pairing.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.messaging.conversationsAll,
      });
      trackFlowStep('profile', 'avatar_uploaded');
      invalidateStylistProfileCaches(queryClient);
    },
    onError: error => {
      // A non-IO throw is step 1 (the direct Cloudinary upload).
      trackFlowStep('profile', 'failed', {
        action: 'avatar_upload',
        code: flowErrorCode(error, 'vendor_upload'),
      });
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const identity = currentIdentity();
      if (!identity) {
        throw new UnverifiedProfileIdentity('Profile identity is unverified');
      }
      const result =
        target === 'person'
          ? await setUserAvatar_IO({ avatar_url: null })
          : await setSalonLogo_IO({ logo_url: null });
      return { result, isCurrent: () => matchesIdentity(identity) };
    },
    meta: { suppressGlobalError: true },
    onSuccess: ({ result, isCurrent }) => {
      if (!isCurrent()) {
        return;
      }
      if ('user_id' in result) {
        queryClient.setQueryData<SafeCurrentUserWire>(
          queryKeys.account.current,
          current => (current ? { ...current, avatar_url: null } : current)
        );
      } else {
        queryClient.setQueryData<SalonProfileData>(
          queryKeys.salon.mine,
          current => (current ? { ...current, logo_url: null } : current)
        );
        void queryClient.invalidateQueries({
          queryKey: [queryKeys.salon.mine[0], 'public'],
        });
      }
      void queryClient.invalidateQueries({
        queryKey: [queryKeys.salon.mine[0], 'public'],
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.staff.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pairing.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.messaging.conversationsAll,
      });
      trackFlowStep('profile', 'avatar_removed');
      invalidateStylistProfileCaches(queryClient);
    },
    onError: error => {
      if (error instanceof UnverifiedProfileIdentity) {
        pushNewSnackbar(tOutcome('saveFailed'), 'error');
      }
      trackFlowStep('profile', 'failed', {
        action: 'avatar_remove',
        code: flowErrorCode(error),
      });
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
