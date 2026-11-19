// UI/features/gallery/components/FirstPhotoProfileCard.organism.tsx
//
// The public-profile card after the first photo (owner): „hej,
// dodałaś pierwsze zdjęcie, uzupełnij swoje dane widoczne na profilu publicznym
// i przypnij tam swoje zdjęcie”. Registration captures the role and optional email opt-in;
// this is where the public name, the city and pinning are asked. Marketing opt-in is
// offered again here if the stylist has not enabled it during registration.
//
// DECISION: the card is skippable ("Później"; a required card would be the same wall she left on,
// only later; skipping is safe, the dashboard checklist keeps the "wizytówka" step open until name
// and city are given). The name starts from the account (Google) and the live preview above the
// fields shows what clients will see. Pin is ticked by default (it is the reason a client sees her
// work on the profile); marketing is NOT (opt-in, never pre-ticked). After saving, the card turns
// into the public link: that is when the profile has something to show (the link moved here from
// onboarding). (owner)

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircleIcon, MapPinIcon } from '@phosphor-icons/react';
import { useProfileCountry } from '../../shared/location/useProfileCountry';
import { CountrySelectMolecule } from '../../shared/location/CountrySelect.molecule';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
import { DEFAULT_EMAIL_PREFERENCES } from '@kernel/models/email/email.dto';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { InputAtom } from '../../../components/Input/Input.atom';
import { CheckboxAtom } from '../../../components/Checkbox/Checkbox.atom';
import { CompletionLineMolecule } from '../../../components/OutcomeFeedback/CompletionLine.molecule';
import { ProfileShareCardOrganism } from '../../shared/profile/ProfileShareCard.organism';
import { trackFlowStep } from '../../../../application/analytics/flow-events';
import { useFirstProfileSave } from '../hooks/useFirstProfileSave';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { authClient } from '../../../../application/auth/better-auth-client';
import { publicNameFromAccount } from '../../auth/onboarding.helpers';
import styles from './FirstPhotoProfileCard.module.css';

interface FirstPhotoProfileCardProps {
  /** The photo she has just published (pinned on save when ticked). */
  galleryRecordId: string;
  /** Public name to start from: the stylist's own, else the account's. */
  initialName: string;
  initialCity: string;
  initialCountry: string | null;
  /** Hide the marketing row when she has already agreed. */
  askMarketing: boolean;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

export function FirstPhotoProfileCardOrganism({
  galleryRecordId,
  initialName,
  initialCity,
  initialCountry,
  askMarketing,
}: FirstPhotoProfileCardProps) {
  const t = useTranslations('pages.gallery.profilePrompt');
  const [name, setName] = useState(initialName);
  const [city, setCity] = useState(initialCity);
  const { country, chooseCountry } = useProfileCountry(
    initialCountry,
    galleryRecordId
  );
  const [pinPhoto, setPinPhoto] = useState(true);
  const [marketing, setMarketing] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const { status, save, skip } = useFirstProfileSave(galleryRecordId);

  const shownRef = useRef(false);
  useEffect(() => {
    if (!shownRef.current) {
      shownRef.current = true;
      trackFlowStep('profile_prompt', 'shown', {
        name_prefilled: initialName.trim() !== '',
      });
    }
  }, [initialName]);

  if (skipped) {
    return null;
  }
  if (status === 'saved') {
    return (
      <div className={styles.saved}>
        <div className={styles.savedNotice}>
          <CheckCircleIcon
            size={44}
            weight='fill'
            className={styles.savedIcon}
            aria-hidden='true'
          />
          <h3 className={styles.savedTitle}>{t('savedTitle')}</h3>
          <p className={styles.savedLine}>{t('saved')}</p>
        </div>
        <ProfileShareCardOrganism ctaVariant='outlined' />
      </div>
    );
  }

  const trimmedName = name.trim();
  const trimmedCity = city.trim();
  const ready =
    trimmedName.length >= VALIDATION_LENGTHS.DISPLAY_NAME_MIN &&
    trimmedCity.length >= VALIDATION_LENGTHS.CITY_MIN &&
    country !== '';
  const pending = status === 'pending';

  return (
    <section className={styles.card} aria-labelledby='first-profile-title'>
      <h2 id='first-profile-title' className={styles.title}>
        {t('title')}
      </h2>
      <p className={styles.body}>{t('body')}</p>

      <div className={styles.preview} aria-hidden='true'>
        <span
          className={styles.previewAvatar}
          data-empty={trimmedName === '' ? 'true' : undefined}>
          {initialsOf(trimmedName)}
        </span>
        <span className={styles.previewLines}>
          <span
            className={styles.previewName}
            data-empty={trimmedName === '' ? 'true' : undefined}>
            {trimmedName === '' ? t('previewName') : trimmedName}
          </span>
          <span
            className={styles.previewCity}
            data-empty={trimmedCity === '' ? 'true' : undefined}>
            <MapPinIcon size={15} weight='fill' />
            {trimmedCity === '' ? t('previewCity') : trimmedCity}
          </span>
        </span>
      </div>

      <div className={styles.fields}>
        <InputAtom
          label={t('nameLabel')}
          placeholder={t('namePlaceholder')}
          autoComplete='name'
          maxLength={VALIDATION_LENGTHS.DISPLAY_NAME_MAX}
          enterKeyHint='next'
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <CountrySelectMolecule
          label={t('countryLabel')}
          placeholder={t('countryPlaceholder')}
          value={country}
          onValueChange={chooseCountry}
        />
        <InputAtom
          label={t('cityLabel')}
          placeholder={t('cityPlaceholder')}
          autoComplete='address-level2'
          maxLength={VALIDATION_LENGTHS.CITY_MAX}
          enterKeyHint='done'
          value={city}
          onChange={e => setCity(e.target.value)}
        />
      </div>

      <div className={styles.options}>
        <CheckboxAtom
          label={t('pinLabel')}
          checked={pinPhoto}
          onChange={e => setPinPhoto(e.target.checked)}
        />
        {askMarketing ? (
          <CheckboxAtom
            label={t('marketingLabel')}
            checked={marketing}
            onChange={e => setMarketing(e.target.checked)}
          />
        ) : null}
      </div>

      <CompletionLineMolecule
        state={status === 'error' ? 'error' : ready ? 'complete' : 'blocked'}
        message={
          status === 'error'
            ? t('error')
            : ready
              ? t('ready')
              : t('needsNameCityCountry')
        }
        reserveMessage={t('needsNameCityCountry')}
      />
      <div className={styles.actions}>
        <ButtonAtom
          type='button'
          variant='primary'
          size='lg'
          disabled={!ready}
          loading={pending}
          onClick={() =>
            void save({
              displayName: trimmedName,
              city: trimmedCity,
              country,
              pinPhoto,
              marketing: askMarketing && marketing,
            })
          }>
          {t('save')}
        </ButtonAtom>
        <ButtonAtom
          type='button'
          variant='text'
          size='md'
          disabled={pending}
          onClick={() => {
            trackFlowStep('profile_prompt', 'skipped');
            skip(pinPhoto);
            setSkipped(true);
          }}>
          {t('later')}
        </ButtonAtom>
      </div>
    </section>
  );
}

export interface FirstProfilePromptDecision {
  galleryRecordId: string;
  initialName: string;
  initialCity: string;
  initialCountry: string | null;
  askMarketing: boolean;
}

/**
 * Whether the first-photo celebration leads with the profile card: yes while
 * the public name or the city is missing (every stylist since the role-only
 * onboarding). Decided once, when the celebration mounts, so saving the card
 * does not swap the screen under her.
 */
export function useFirstProfilePromptDecision(
  galleryRecordId: string | undefined
): FirstProfilePromptDecision | null {
  const { data: currentUser } = useCurrentUserAccount();
  const { data: session } = authClient.useSession();
  const account = currentUser?.stylist_account ?? null;
  const [decision] = useState<FirstProfilePromptDecision | null>(() =>
    account !== null &&
    galleryRecordId !== undefined &&
    (!account.display_name?.trim() || !account.address_city?.trim())
      ? {
          galleryRecordId,
          initialName:
            account.display_name?.trim() ||
            publicNameFromAccount(session?.user?.name || currentUser?.name) ||
            '',
          initialCity: account.address_city?.trim() ?? '',
          initialCountry: account.address_country,
          askMarketing: !(
            account.email_preferences?.marketing ??
            DEFAULT_EMAIL_PREFERENCES.marketing
          ),
        }
      : null
  );
  return decision;
}
