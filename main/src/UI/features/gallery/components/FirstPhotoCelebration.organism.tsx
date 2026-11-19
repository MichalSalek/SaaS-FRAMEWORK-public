import type { ReactNode } from 'react';
import { HandshakeIcon, PlusIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { SuccessSceneOrganism } from '../../../components/OutcomeFeedback/SuccessScene.organism';
import {
  FirstPhotoProfileCardOrganism,
  useFirstProfilePromptDecision,
} from './FirstPhotoProfileCard.organism';
import styles from '../UploadAssetPage.module.css';

interface FirstPhotoCelebrationProps {
  onGoToPairing: () => void;
  onAddAnother: () => void;
  onGoToGallery: () => void;
  photoSrc: string | null;
  /** The photo just published (the profile card pins it). */
  galleryRecordId: string | undefined;
  /** Shown under the actions when the profile is already complete. */
  aside?: ReactNode;
}

// DECISION: while the profile has no public name or city (every stylist since the role-only
// onboarding), the profile card IS the content of the success screen: it stands in the paper
// panel, its "Zapisz wizytówkę" is the form action, and the screen-level actions are docked at
// the bottom. Measured at 393x695: below the photo and three buttons the card started past the
// fold. With a complete profile the screen shows the published photo, "Dodaj kolejne zdjęcie"
// and the older marketing question. (owner)
export function FirstPhotoCelebrationOrganism({
  onGoToPairing,
  onAddAnother,
  onGoToGallery,
  photoSrc,
  galleryRecordId,
  aside,
}: FirstPhotoCelebrationProps) {
  const t = useTranslations('pages.gallery');
  const prompt = useFirstProfilePromptDecision(galleryRecordId);

  const secondaryActions = (
    <>
      <ButtonAtom
        variant='outlined'
        size='md'
        icon={<HandshakeIcon size={18} />}
        onClick={onGoToPairing}>
        {t('celebrationGoToPairing')}
      </ButtonAtom>
      <ButtonAtom variant='text' size='md' onClick={onGoToGallery}>
        {t('celebrationGoToGallery')}
      </ButtonAtom>
    </>
  );

  if (prompt !== null) {
    return (
      <SuccessSceneOrganism
        firstTime
        presentation='glory'
        actionDock
        title={t('celebrationTitle')}
        body={
          <FirstPhotoProfileCardOrganism
            galleryRecordId={prompt.galleryRecordId}
            initialName={prompt.initialName}
            initialCity={prompt.initialCity}
            initialCountry={prompt.initialCountry}
            askMarketing={prompt.askMarketing}
          />
        }
        actions={
          <>
            <ButtonAtom
              variant='outlined'
              size='md'
              icon={<PlusIcon size={18} weight='fill' />}
              onClick={onAddAnother}>
              {t('uploadAddAnother')}
            </ButtonAtom>
            {secondaryActions}
          </>
        }
        aside={aside}
      />
    );
  }

  return (
    <SuccessSceneOrganism
      firstTime
      presentation='glory'
      actionDock
      title={t('celebrationTitle')}
      body={t('celebrationHint')}
      preview={
        photoSrc ? (
          <div className={styles.successPhotoFrame}>
            <Image
              src={photoSrc}
              alt={t('uploadPreviewAlt')}
              width={240}
              height={320}
              className={styles.successPhoto}
              unoptimized
            />
          </div>
        ) : undefined
      }
      actions={
        <>
          <ButtonAtom
            variant='primary'
            size='lg'
            icon={<PlusIcon size={18} weight='fill' />}
            onClick={onAddAnother}>
            {t('uploadAddAnother')}
          </ButtonAtom>
          {secondaryActions}
        </>
      }
      aside={aside}
    />
  );
}
