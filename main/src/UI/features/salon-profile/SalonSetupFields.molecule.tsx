import type { CountryCode } from '@kernel/domain/localization/country.config';
import { CountrySelectMolecule } from '../shared/location/CountrySelect.molecule';
import { useTranslations } from 'next-intl';
import { BrandColorFieldMolecule } from '../shared/branding/BrandColorField.molecule';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { InputAtom } from '../../components/Input/Input.atom';
import { SoftBreakTextAtom } from '../../components/SoftBreakText/SoftBreakText.atom';
import { CheckboxAtom } from '../../components/Checkbox/Checkbox.atom';
import { ProfileManageSectionMolecule } from '../shared/profile/ProfileManageSection.molecule';
import { ExternalLinksFieldMolecule } from '../shared/profile/ExternalLinksField.molecule';
import type { SalonContactDraft } from './salonProfileDraft';
import type { Dispatch, KeyboardEvent, ReactNode, SetStateAction } from 'react';
import styles from './SalonProfileManage.module.css';

export type { SalonContactDraft } from './salonProfileDraft';

type SalonContactTextKey =
  'address_city' | 'address_street' | 'website' | 'instagram_handle' | 'phone';

type FieldCommit = {
  onBlur?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
};

/** Name and public address: what makes the salon profile exist. */
export function SalonIdentitySectionMolecule({
  name,
  setName,
  nameError,
  slug,
  setSlug,
  slugMessage,
  slugError,
  slugPreview,
  published,
  commit,
  status,
}: {
  name: string;
  setName: Dispatch<SetStateAction<string>>;
  nameError?: string | undefined;
  slug: string;
  setSlug: Dispatch<SetStateAction<string>>;
  slugMessage: string;
  /** The message is an error (rules broken, link taken): shown on the field. */
  slugError: boolean;
  /** The full address the slug makes (host, then /s/ and the slug); null
   *  when it is the saved one, which the link card above already shows. */
  slugPreview: string | null;
  /** A published salon already has a link in clients' hands. */
  published: boolean;
  /** Autosave of a published salon: leaving a field saves it. */
  commit?: { name: FieldCommit; slug: FieldCommit };
  status?: ReactNode;
}) {
  const t = useTranslations('salon.profile');
  const setup = useTranslations('salon.setup');
  return (
    <ProfileManageSectionMolecule
      id='salon-identity'
      title={setup('identitySection')}
      status={status}>
      <InputAtom
        label={t('name')}
        value={name}
        maxLength={100}
        error={nameError}
        onChange={event => setName(event.target.value)}
        {...commit?.name}
      />
      <div className={styles.slugField}>
        <InputAtom
          label={t('slugLabel')}
          value={slug}
          maxLength={50}
          autoComplete='off'
          autoCapitalize='none'
          autoCorrect='off'
          spellCheck={false}
          error={slugError ? slugMessage : undefined}
          onChange={event => setSlug(event.target.value.toLowerCase())}
          {...commit?.slug}
        />
        <div className={styles.slugStatus}>
          {slugPreview !== null && (
            <TypographyAtom variant='body2' className={styles.slugPreview}>
              <SoftBreakTextAtom>{slugPreview}</SoftBreakTextAtom>
            </TypographyAtom>
          )}
          {/* Empty for the saved link: the card above already shows it. */}
          <TypographyAtom variant='body2' aria-live='polite'>
            {slugError ? '' : slugMessage}
          </TypographyAtom>
          {/* DECISION: a changed link saves on leaving the field like every other field, with no
              confirmation: the old link stays reserved for the salon and leads to the new one
              (owner), so nothing already in clients' hands breaks. */}
          {published && (
            <TypographyAtom variant='body2' className={styles.slugHint}>
              {t('slugChangeHint')}
            </TypographyAtom>
          )}
        </div>
      </div>
    </ProfileManageSectionMolecule>
  );
}

export function SalonLocationSectionMolecule({
  contact,
  setContact,
  onCountryChange,
  cityError,
  commit,
  status,
}: {
  contact: SalonContactDraft;
  setContact: Dispatch<SetStateAction<SalonContactDraft>>;
  onCountryChange: (next: CountryCode) => void;
  cityError?: string | undefined;
  commit?: FieldCommit;
  status?: ReactNode;
}) {
  const setup = useTranslations('salon.setup');
  const tBrand = useTranslations('account.profile');
  const field =
    (key: SalonContactTextKey) => (event: { target: { value: string } }) =>
      setContact(current => ({ ...current, [key]: event.target.value }));
  return (
    <ProfileManageSectionMolecule
      id='salon-location'
      title={tBrand('locationSection')}
      description={setup('locationHelp')}
      status={status}>
      <CountrySelectMolecule
        label={tBrand('countryLabel')}
        placeholder={tBrand('countryPlaceholder')}
        value={contact.address_country}
        onValueChange={onCountryChange}
      />
      <InputAtom
        label={tBrand('cityLabel')}
        value={contact.address_city}
        error={cityError}
        maxLength={100}
        onChange={field('address_city')}
        {...commit}
      />
      <InputAtom
        label={tBrand('streetLabel')}
        value={contact.address_street}
        maxLength={200}
        onChange={field('address_street')}
        {...commit}
      />
    </ProfileManageSectionMolecule>
  );
}

export function SalonContactSectionMolecule({
  contact,
  setContact,
  commit,
  onCommitLinks,
  status,
}: {
  contact: SalonContactDraft;
  setContact: Dispatch<SetStateAction<SalonContactDraft>>;
  /** Autosave of a published salon: leaving any field saves the box. */
  commit?: FieldCommit;
  /** Links need the fresh array, not the state that React has not applied yet. */
  onCommitLinks?: (next: string[]) => void;
  status?: ReactNode;
}) {
  const setup = useTranslations('salon.setup');
  const tBrand = useTranslations('account.profile');
  const field =
    (key: SalonContactTextKey) => (event: { target: { value: string } }) =>
      setContact(current => ({ ...current, [key]: event.target.value }));
  return (
    <ProfileManageSectionMolecule
      id='salon-contact'
      title={setup('contactSection')}
      description={setup('contactHelp')}
      status={status}>
      <InputAtom
        label={tBrand('phoneLabel')}
        type='tel'
        value={contact.phone}
        maxLength={30}
        onChange={field('phone')}
        {...commit}
      />
      <InputAtom
        label={tBrand('websiteLabel')}
        inputMode='url'
        value={contact.website}
        maxLength={500}
        onChange={field('website')}
        {...commit}
      />
      <InputAtom
        label={tBrand('instagramLabel')}
        value={contact.instagram_handle}
        maxLength={30}
        onChange={field('instagram_handle')}
        {...commit}
      />
      <ExternalLinksFieldMolecule
        value={contact.external_links}
        onChange={next =>
          setContact(current => ({ ...current, external_links: next }))
        }
        onCommit={next => onCommitLinks?.(next)}
        labels={{
          title: tBrand('linksTitle'),
          hint: tBrand('linksHint'),
          inputLabel: tBrand('linksInputLabel'),
          add: tBrand('linksAdd'),
          remove: tBrand('linksRemove'),
          invalid: tBrand('linksInvalid'),
        }}
      />
    </ProfileManageSectionMolecule>
  );
}

export function SalonBrandSectionMolecule({
  accent,
  onSelect,
  status,
}: {
  accent: string | null;
  onSelect: (accent: string | null) => void;
  status?: ReactNode;
}) {
  const t = useTranslations('salon.profile');
  const setup = useTranslations('salon.setup');
  return (
    <ProfileManageSectionMolecule id='salon-colour' title={t('brandColour')}>
      <BrandColorFieldMolecule
        id='salon-brand-colour'
        label={setup('brandChoice')}
        hint={t('brandColourHint')}
        value={accent ?? ''}
        // The salon screen exists only for an active Studio or Scale owner,
        // and both plans include the brand colour.
        canBrand
        onSelect={hex => onSelect(hex || null)}
        status={status}
      />
    </ProfileManageSectionMolecule>
  );
}

export function SalonTeamSectionMolecule({
  showTeam,
  setShowTeam,
  roster,
  status,
}: {
  showTeam: boolean;
  setShowTeam: (showTeam: boolean) => void;
  status?: ReactNode;
  roster: { hasData: boolean; members: { accepted_at: string | null }[] };
}) {
  const t = useTranslations('salon.profile');
  const setup = useTranslations('salon.setup');
  return (
    <ProfileManageSectionMolecule
      id='salon-team'
      title={setup('teamTitle')}
      status={status}>
      <NavRowListMolecule>
        <NavRowMolecule
          href={ROUTES_FRONT.SALON_STAFF}
          label={setup('manageTeam')}
          description={
            !roster.hasData
              ? setup('teamLoading')
              : roster.members.length === 0
                ? setup('teamEmpty')
                : setup('teamCount', {
                    count: roster.members.filter(
                      member => member.accepted_at != null
                    ).length,
                    pending: roster.members.filter(
                      member => member.accepted_at == null
                    ).length,
                  })
          }
          trailing='disc'
        />
      </NavRowListMolecule>
      <CheckboxAtom
        checked={showTeam}
        label={t('showTeam')}
        onChange={event => setShowTeam(event.target.checked)}
      />
    </ProfileManageSectionMolecule>
  );
}
