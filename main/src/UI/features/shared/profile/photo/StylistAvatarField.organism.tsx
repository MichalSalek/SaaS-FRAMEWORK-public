import { OutcomeStateMolecule } from '../../../../components/OutcomeFeedback/OutcomeState.molecule';
// UI/features/account/components/StylistAvatarField.organism.tsx
// Stylist profile photo on the "Twój publiczny profil" screen.
//
// DECISION: we upload an AVATAR; the profile cover stays generative (tone computed from the brand
// color), so there is one file picker and no field for a background. (owner)
//
// Three photo states, in order: own upload → image from the Google account → initials
// (`AvatarAtom`). "Usuń" undoes ONLY the first level, so it shows only when there is something to
// undo; otherwise the button would promise to delete a photo that cannot be removed from here (it
// comes from Google).

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import {
  BuildingIcon,
  TrashIcon,
  UploadSimpleIcon,
} from '@phosphor-icons/react';
import { AvatarAtom } from '../../../../components/Avatar/Avatar.atom';
import { ButtonAtom } from '../../../../components/Button/Button.atom';
import { useCurrentUserAccount } from '../../../../shared/hooks/useCurrentUserAccount';
import { pushNewSnackbar } from '../../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { isIOError } from '../../../../../application/http/io';
import { useUploadAvatar } from './useUploadAvatar';
import { AvatarCropDialogOrganism } from './AvatarCropDialog.organism';
import {
  ACCEPTED_IMAGE_ACCEPT_ATTR,
  isAcceptedImageMimeType,
} from '../../../../shared/image/imageUpload.config';
import styles from './StylistAvatarField.module.css';

// An input ceiling, not a target: after the square crop and JPEG recompression the file shrinks to
// a few hundred kilobytes anyway. 8 MB lets a photo straight from a phone through and rejects a
// mirrorless camera file.
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;

interface StylistAvatarFieldProps {
  target?: 'person' | 'logo';
  logoUrl?: string | null | undefined;
  compact?: boolean;
}

export function StylistAvatarFieldOrganism({
  target = 'person',
  logoUrl,
  compact = false,
}: StylistAvatarFieldProps) {
  const t = useTranslations('account.avatar');
  const tOutcome = useTranslations('components.outcomeFeedback');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: user } = useCurrentUserAccount();
  const { upload, remove } = useUploadAvatar(target);

  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // DECISION: the crop dialog's visibility has its OWN state, separate from the chosen file. If
  // closing meant clearing the file, the whole dialog would unmount in the same tick, and
  // AppDialog's exit animation is driven by `data-ending-style`, which needs the element to stay
  // ALIVE for the transition. Closing by unmount jerks instead of fading (canon: StylistUnpairDialog
  // keeps the dialog mounted and toggles `open`). The file and its preview stay until the next pick
  // or unmount, when the cleanup effect below releases them.
  const [isCropOpen, setIsCropOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const ownAvatarUrl =
    target === 'logo' ? (logoUrl ?? null) : (user?.avatar_url ?? null);
  const fallbackImageUrl = target === 'person' ? (user?.image ?? null) : null;
  const displayName =
    user?.name?.trim() || user?.email?.split('@')[0] || t('unnamedFallback');
  const isBusy = upload.isPending || remove.isPending;

  const closeCrop = () => {
    setIsCropOpen(false);
    // Without resetting the input, re-picking the SAME file does not fire `change`.
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) {
      return;
    }
    if (!isAcceptedImageMimeType(file.type)) {
      pushNewSnackbar(t('invalidFileType'), 'error');
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      pushNewSnackbar(t('fileTooLarge'), 'error');
      return;
    }
    upload.reset();
    setPickedFile(file);
    // `createObjectURL` is called OUTSIDE the state updater: React strict mode calls updaters twice,
    // so a side effect inside would create two blob URLs, one left without an owner and without a
    // chance to be released (same trap as in useUploadAssetState).
    setPreviewUrl(URL.createObjectURL(file));
    setIsCropOpen(true);
  };

  const handleCropConfirm = async (croppedFile: File) => {
    closeCrop();
    try {
      await upload.mutateAsync(croppedFile);
    } catch (e) {
      // Step 2 (our API) is toasted by the interceptor from the backend event. Step 1 (file upload to
      // the cloud) bypasses the interceptor, so without this it would be silent; only for it, to
      // avoid a duplicate message.
      if (!isIOError(e)) {
        pushNewSnackbar(t('uploadFailed'), 'error');
      }
    }
  };

  return (
    <div className={styles.field}>
      {!compact && target === 'person' && (
        <p className={styles.label}>{t('label')}</p>
      )}

      <div className={styles.row}>
        {target === 'logo' ? (
          <LogoPreview url={ownAvatarUrl} />
        ) : compact ? (
          <button
            type='button'
            className={styles.avatarButton}
            aria-label={t(ownAvatarUrl ? 'changeCta' : 'uploadCta')}
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy}>
            <AvatarAtom
              src={ownAvatarUrl ?? undefined}
              fallbackSrc={fallbackImageUrl ?? undefined}
              name={displayName}
              size='lg'
              decorative
            />
          </button>
        ) : (
          <AvatarAtom
            src={ownAvatarUrl ?? undefined}
            fallbackSrc={fallbackImageUrl ?? undefined}
            name={displayName}
            size='xl'
            decorative
          />
        )}

        <div className={styles.actions}>
          <input
            ref={fileInputRef}
            type='file'
            accept={ACCEPTED_IMAGE_ACCEPT_ATTR}
            onChange={handleFileSelect}
            className={styles.hiddenInput}
            aria-hidden='true'
            tabIndex={-1}
          />
          <ButtonAtom
            variant='outlined'
            size='sm'
            icon={<UploadSimpleIcon size={16} />}
            loading={isBusy}
            onClick={() => fileInputRef.current?.click()}>
            {target === 'logo'
              ? t(ownAvatarUrl ? 'logoChangeCta' : 'logoUploadCta')
              : t(ownAvatarUrl ? 'changeCta' : 'uploadCta')}
          </ButtonAtom>

          {ownAvatarUrl !== null && (
            <ButtonAtom
              variant='outlined'
              size='sm'
              icon={<TrashIcon size={16} />}
              disabled={isBusy}
              onClick={() => {
                upload.reset();
                remove.mutate();
              }}>
              {t(target === 'logo' ? 'logoRemoveCta' : 'removeCta')}
            </ButtonAtom>
          )}
        </div>
      </div>

      <OutcomeStateMolecule
        confirmed={upload.isSuccess && !isBusy}
        message={upload.isSuccess && !isBusy ? tOutcome('saveDone') : undefined}
      />
      {target === 'person' && !compact && (
        <p className={styles.hint}>
          {ownAvatarUrl
            ? t('hintOwn')
            : fallbackImageUrl
              ? t('hintFromProvider')
              : t('hintInitials')}
        </p>
      )}

      {/* The dialog STAYS mounted after the first file pick: the `open` flag closes it, not unmounting,
          so the exit animation has time to play. */}
      {pickedFile && previewUrl && (
        <AvatarCropDialogOrganism
          open={isCropOpen}
          mode={target}
          previewUrl={previewUrl}
          originalFile={pickedFile}
          onCancel={closeCrop}
          onConfirm={file => void handleCropConfirm(file)}
        />
      )}
    </div>
  );
}

function LogoPreview({ url }: { url: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className={styles.logoPreview} aria-hidden='true'>
      {url && failed !== url ? (
        <Image
          src={url}
          alt=''
          width={96}
          height={96}
          unoptimized
          onError={() => setFailed(url)}
        />
      ) : (
        <BuildingIcon size={40} />
      )}
    </span>
  );
}
