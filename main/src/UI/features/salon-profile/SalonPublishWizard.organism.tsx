// UI/features/salon-profile/SalonPublishWizard.organism.tsx
// The first configuration of a salon that has no public page yet: name and
// link, then optional contact and colour, then ONE filled „Opublikuj”.
// The optional logo saves independently; the public page is created only by that button. After it the screen is the editor
// that saves itself (DECISION in SalonProfileManage.organism.tsx).

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { SalonProfileData } from '@kernel/models/salon-profile/salon-profile.dto';
import { updateSalonProfile_IO } from '../../../domain/salon-profile/salonProfileIO.possibilities.api';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { CompletionLineMolecule } from '../../components/OutcomeFeedback/CompletionLine.molecule';
import { SoftBreakTextAtom } from '../../components/SoftBreakText/SoftBreakText.atom';
import { StepIndicatorAtom } from '../../components/StepIndicator/StepIndicator.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { useProfileCountry } from '../shared/location/useProfileCountry';
import { useLeaveGuard } from '../../shared/hooks/useLeaveGuard';
import { StylistAvatarFieldOrganism } from '../shared/profile/photo/StylistAvatarField.organism';
import { ProfileManageSectionMolecule } from '../shared/profile/ProfileManageSection.molecule';
import {
  SalonBrandSectionMolecule,
  SalonContactSectionMolecule,
  SalonIdentitySectionMolecule,
  SalonLocationSectionMolecule,
} from './SalonSetupFields.molecule';
import {
  traceSalonProfileFailed,
  traceSalonProfilePublished,
} from './salonProfileFlowTrace';
import { useSalonSlugField } from './useSalonSlugField';
import {
  buildSalonUpdate,
  canPublish,
  fingerprint,
  initialDraft,
} from './salonProfileDraft';
import styles from './SalonProfileManage.module.css';

type WizardStep = 'identity' | 'details';

export function SalonPublishWizardOrganism({
  profile,
  onPublished,
}: {
  profile: SalonProfileData;
  onPublished: (response: SalonProfileData) => void;
}) {
  const t = useTranslations('salon.profile');
  const setup = useTranslations('salon.setup');
  const tBrand = useTranslations('account.profile');
  const tAvatar = useTranslations('account.avatar');
  const start = initialDraft(profile);
  const [step, setStep] = useState<WizardStep>('identity');
  const [name, setName] = useState(start.name);
  const [slug, setSlug] = useState(start.slug);
  const [contact, setContact] = useState(start.contact);
  const { country, chooseCountry, isManual } = useProfileCountry(
    profile.contact.address_country,
    profile.account_id
  );
  const streetNeedsCity =
    contact.address_street.trim() !== '' && contact.address_city.trim() === '';
  const [accent, setAccent] = useState(start.accent);
  const [nameTouched, setNameTouched] = useState(false);
  const slugField = useSalonSlugField(slug, null, profile);
  const draft = {
    ...start,
    name,
    slug,
    contact: { ...contact, address_country: country },
    accent,
  };
  // Looking at the suggestions and leaving asks nothing; only what she typed.
  useLeaveGuard({
    when:
      fingerprint(
        isManual
          ? draft
          : {
              ...draft,
              contact: {
                ...draft.contact,
                address_country: start.contact.address_country,
              },
            }
      ) !== fingerprint(start),
    message: t('unsaved'),
  });
  const ready = canPublish({
    name,
    validSlug: slugField.validSlug,
    availability: slugField.state,
  });
  const publish = useMutation({
    mutationFn: () =>
      updateSalonProfile_IO(buildSalonUpdate(draft, slug), {
        // The screen owns the outcome: the page turns into the editor with
        // the live link and says it is published there.
        successFeedback: 'screen',
      }),
    meta: { suppressGlobalError: true },
    onError: error => {
      traceSalonProfileFailed(error);
      // The link may have been taken in the meantime: the first step says so.
      setStep('identity');
    },
    onSuccess: response => {
      traceSalonProfilePublished(
        Object.values(response.contact).some(value => Boolean(value))
      );
      onPublished(response);
    },
  });
  const steps = [
    { id: 'identity', label: setup('identitySection') },
    { id: 'details', label: setup('detailsStep') },
  ] as const;
  const address = slugField.preview;

  return (
    <div className={styles.wizard}>
      <TypographyAtom variant='body2' className={styles.wizardLead}>
        {setup('wizardLead')}
      </TypographyAtom>
      <StepIndicatorAtom
        steps={steps}
        currentId={step}
        ariaLabel={setup('stepsLabel')}
        counterLabel={setup('stepCounter', {
          current: step === 'identity' ? 1 : 2,
          total: steps.length,
        })}
      />
      <form
        className={styles.wizard}
        onSubmit={event => {
          event.preventDefault();
          if (step === 'identity') {
            if (ready) {
              setStep('details');
            }
            return;
          }
          if (ready && !publish.isPending && !streetNeedsCity) {
            publish.mutate();
          }
        }}>
        {step === 'identity' ? (
          <>
            <ProfileManageSectionMolecule
              id='salon-logo'
              title={tAvatar('logoLabel')}>
              <StylistAvatarFieldOrganism
                target='logo'
                logoUrl={profile.logo_url}
              />
            </ProfileManageSectionMolecule>
            <SalonIdentitySectionMolecule
              name={name}
              setName={setName}
              nameError={
                nameTouched && !name.trim() ? t('nameRequired') : undefined
              }
              slug={slug}
              setSlug={setSlug}
              slugPreview={address}
              slugMessage={slugField.message}
              slugError={slugField.isError}
              published={false}
              commit={{
                name: { onBlur: () => setNameTouched(true) },
                slug: {},
              }}
            />
          </>
        ) : (
          <>
            <SalonLocationSectionMolecule
              contact={{ ...contact, address_country: country }}
              setContact={setContact}
              onCountryChange={chooseCountry}
              cityError={
                streetNeedsCity ? tBrand('locationCityRequired') : undefined
              }
            />
            <SalonContactSectionMolecule
              contact={contact}
              setContact={setContact}
            />
            <SalonBrandSectionMolecule accent={accent} onSelect={setAccent} />
          </>
        )}
        <div className={styles.wizardActions}>
          {step === 'details' && address !== null && (
            <div className={styles.slugStatus}>
              <TypographyAtom variant='body2' className={styles.publishHint}>
                {setup('publishHint')}
              </TypographyAtom>
              <TypographyAtom variant='body2' className={styles.slugPreview}>
                <SoftBreakTextAtom>{address}</SoftBreakTextAtom>
              </TypographyAtom>
            </div>
          )}
          {publish.isError && (
            <CompletionLineMolecule
              state='error'
              message={setup('publishFailed')}
            />
          )}
          <div className={styles.wizardButtons}>
            {step === 'details' && (
              <ButtonAtom
                type='button'
                variant='outlined'
                disabled={publish.isPending}
                onClick={() => setStep('identity')}>
                {setup('back')}
              </ButtonAtom>
            )}
            {step === 'identity' ? (
              <ButtonAtom
                type='submit'
                variant='primary'
                direction='forward'
                disabled={!ready}>
                {setup('next')}
              </ButtonAtom>
            ) : (
              <ButtonAtom
                type='submit'
                variant='primary'
                disabled={!ready}
                loading={publish.isPending}>
                {t('publish')}
              </ButtonAtom>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
