import { getEffectivePricingPlan } from '@kernel/domain/pricing/effective-plan';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { SafeStylistAccountWire } from '@kernel/domain/user/user.contract-schemas';
import {
  PRICING_POLICY,
  narrowPricingPlan,
} from '@kernel/policies/pricing.policy';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
import { normalizeCountryCode } from '@kernel/domain/localization/country.config';
import { useProfileCountry } from '../../shared/location/useProfileCountry';
import { InputAtom } from '../../../components/Input/Input.atom';
import { hasOwnSalon } from '../../../../application/policies/salon-ownership.policy';
import { ProfileManageSectionMolecule } from '../../shared/profile/ProfileManageSection.molecule';
import { useStylistProfileFieldSaves } from './useStylistProfileFieldSaves';
import { StylistProfileLinkBoxMolecule } from './StylistProfileLinkBox.molecule';
import { StylistAvatarFieldOrganism } from '../../shared/profile/photo/StylistAvatarField.organism';
import {
  StylistProfileSaveLineMolecule,
  type StylistProfileBox as Box,
  type StylistProfileSaveSection as SaveSection,
} from './StylistProfileSaveLine.molecule';
import { StylistProfileContactBoxMolecule } from './StylistProfileContactBox.molecule';
import { StylistProfileLocationBoxMolecule } from './StylistProfileLocationBox.molecule';
import { PublicBioEditorOrganism } from '../../shared/profile/PublicBioEditor.organism';
import { StylistPublicNameFieldMolecule } from './StylistPublicNameField.molecule';
import { StylistBrandColorFieldOrganism } from './StylistBrandColorField.organism';
import { useUpdateStylistProfile } from '../../shared/profile/hooks/useUpdateStylistProfile';
import { useSingleFlightSaves } from '../../shared/profile/hooks/useSingleFlightSaves';
import { sanitizeExternalLinks } from '@kernel/domain/user-and-account/external-links.config';
import styles from './StylistProfileSection.module.css';
import { normalizePhoneForComparison } from './stylistProfile.helpers';

interface StylistProfileSectionProps {
  stylistAccount: SafeStylistAccountWire;
}

type UpdateRequest = ACCOUNT_DTO_API_V1['UPDATE_STYLIST_PROFILE']['REQUEST'];

export function StylistProfileSectionOrganism({
  stylistAccount,
}: StylistProfileSectionProps) {
  const [city, setCity] = useState(stylistAccount.address_city ?? '');
  const { country, chooseCountry } = useProfileCountry(
    stylistAccount.address_country,
    stylistAccount.account_id
  );
  const [street, setStreet] = useState(stylistAccount.address_street ?? '');
  const [salonName, setSalonName] = useState(
    stylistAccount.business_name ?? ''
  );
  const [phone, setPhone] = useState(stylistAccount.phone ?? '');
  // DECISION: `website` existed in the DB and the update DTO but had NO UI field, so the column could
  // not be set. It is now closed end to end: what is typed here lands on the public profile (the
  // meta bar in StylistProfileHeader) AND in `sameAs` of the NailSalon node (_jsonld.helpers).
  // Server validation requires a full https:// (validateOptionalHttpsUrl) and the schema adds
  // normalizeWebsiteUrl on save, so typing `velvet-nails.example.com` is enough. The field is `type='text'` +
  // `inputMode='url'`; the reason is in the comment at the `<InputAtom>` below.
  const [website, setWebsite] = useState(stylistAccount.website ?? '');
  const [instagram, setInstagram] = useState(
    stylistAccount.instagram_handle ?? ''
  );
  const [links, setLinks] = useState<string[]>(() =>
    sanitizeExternalLinks(stylistAccount.external_links)
  );
  const [vanityUrl, setVanityUrl] = useState(stylistAccount.vanity_url ?? '');
  // Brand colour: '' = default (the app accent on the public profile).
  const [accentColor, setAccentColor] = useState(
    stylistAccount.brand_accent_color ?? ''
  );

  // DECISION: re-seed the fields ONLY when the account IDENTITY changes (mount / become-user /
  // role-switch), NOT on every refetch of the same account. Autosave (below) calls
  // updateProfile.mutate → onSuccess → invalidateStylistProfileCaches → invalidates
  // queryKeys.account.current, which feeds `stylistAccount` (user.stylist_account). A refetch yields
  // a NEW object reference, so an unconditional reset on [stylistAccount] would overwrite a field
  // the user is EDITING but has not blurred/saved yet: silent data loss (sibling ClientProfilePage
  // guards with isEditingRef). Guarding on account_id makes the refetch after autosave a no-op;
  // after a successful save the prop already carries the saved value, so the dirty flags reset
  // without this effect. Deliberate trade-off: an external change to THIS account's fields (e.g. by
  // an admin) does not refresh the input until remount; leaving in-progress edits untouched wins.
  const syncedAccountIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (syncedAccountIdRef.current === stylistAccount.account_id) {
      return;
    }
    syncedAccountIdRef.current = stylistAccount.account_id;
    setCity(stylistAccount.address_city ?? '');
    setStreet(stylistAccount.address_street ?? '');
    setSalonName(stylistAccount.business_name ?? '');
    setPhone(stylistAccount.phone ?? '');
    setWebsite(stylistAccount.website ?? '');
    setInstagram(stylistAccount.instagram_handle ?? '');
    setLinks(sanitizeExternalLinks(stylistAccount.external_links));
    setVanityUrl(stylistAccount.vanity_url ?? '');
    setAccentColor(stylistAccount.brand_accent_color ?? '');
  }, [stylistAccount]);

  const t = useTranslations('account.profile');
  const updateProfile = useUpdateStylistProfile();

  // DECISION: an account WITHOUT a profile address has nothing to share, so the address field is
  // the first field of the form and gets the screen's only filled button ("Ustaw adres"). A card
  // with a "Ustaw własny link" button that led to THIS SAME screen used to stand there while the
  // real field lay seven fields lower. The state is latched at mount: after saving the address the
  // field stays where she filled it instead of jumping to the end.
  const [leadsWithAddress] = useState(() => !stylistAccount.vanity_url);

  // The bio saves as its own section. City and street save apart from phone
  // and the website, so contact does not wait for a city.
  const businessNameDirty = salonName !== (stylistAccount.business_name ?? '');
  const locationDirty =
    country !== (normalizeCountryCode(stylistAccount.address_country) ?? '') ||
    city !== (stylistAccount.address_city ?? '') ||
    street !== (stylistAccount.address_street ?? '');
  const savedLinks = sanitizeExternalLinks(stylistAccount.external_links);
  const linksDirty =
    JSON.stringify(sanitizeExternalLinks(links)) !== JSON.stringify(savedLinks);
  // The contact box groups three independent API sections; only phone and
  // website belong to the contact save itself.
  const contactFieldsDirty =
    normalizePhoneForComparison(phone) !==
      normalizePhoneForComparison(stylistAccount.phone) ||
    website !== (stylistAccount.website ?? '');
  const contactBoxDirty =
    contactFieldsDirty ||
    instagram !== (stylistAccount.instagram_handle ?? '') ||
    linksDirty;
  const streetNeedsCity = street.trim() !== '' && city.trim() === '';

  // Gate UI (the hard gate lives on the backend): brand colour from the Pro Marka plan.
  const canBrand =
    PRICING_POLICY.LIMITS[
      narrowPricingPlan(getEffectivePricingPlan(stylistAccount))
    ].can_brand_profile;

  // AUTOSAVE: the per-section handlers live in useStylistProfileFieldSaves. The box whose field
  // started the latest save reports it in its own line under the fields.
  const { save, retry, discard, isBusy, isSaving, failedSections } =
    useSingleFlightSaves<SaveSection, UpdateRequest>(updateProfile.mutateAsync);
  // The box whose field started the latest save: its save line reports it.
  const [savingBox, setSavingBox] = useState<Box | null>(null);
  const inBox = (box: Box, commit: () => void) => {
    setSavingBox(box);
    commit();
  };
  const {
    saveBusinessName,
    saveLocation,
    saveContact,
    saveVanity,
    saveInstagram,
    saveLinks,
    saveAccent,
  } = useStylistProfileFieldSaves({
    stylistAccount,
    businessNameDirty,
    locationDirty,
    contactFieldsDirty,
    salonName,
    country,
    city,
    street,
    phone,
    website,
    instagram,
    vanityUrl,
    setters: {
      setWebsite,
      setVanityUrl,
      setInstagram,
      setLinks,
      setAccentColor,
    },
    saves: { save, discard, isBusy },
  });

  // Enter in a one-line field = commit (blur fires the save); without this Enter did nothing, and
  // "Enter = save" is a common habit.
  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  const savedVanity = stylistAccount.vanity_url ?? '';

  // DECISION: the profile fields stand in white boxes by meaning (identity, contact, link, colour),
  // the same kind of boxes as the salon screen, so both profiles read alike (owner:
  // „make them uniform”). The personal profile autosaves while the salon has a save button, so
  // each text box reports actual saves beside its fields. No repeated
  // instructions at rest. The box whose field she last left reports the save.
  const boxDirty: Record<Box, boolean> = {
    identity: businessNameDirty,
    location: locationDirty,
    contact: contactBoxDirty,
    link: vanityUrl !== savedVanity,
  };
  const saveLine = (box: Box) => (
    <StylistProfileSaveLineMolecule
      resetKey={`${stylistAccount.account_id}-${box}`}
      box={box}
      isSaving={isSaving && savingBox === box}
      isDirty={boxDirty[box]}
      failedSections={failedSections}
      onRetry={retry}
    />
  );

  const linkBox = (
    <StylistProfileLinkBoxMolecule
      value={vanityUrl}
      onChange={setVanityUrl}
      savedValue={savedVanity}
      error={failedSections.has('vanity') ? t('fieldNotSaved') : undefined}
      onCommit={() => inBox('link', saveVanity)}
      onKeyDown={blurOnEnter}
      {...(leadsWithAddress && {
        setAction: {
          loading: isSaving && savingBox === 'link',
          onClick: () => {
            if (!isBusy('vanity')) {
              inBox('link', saveVanity);
            }
          },
        },
      })}
      saveLine={saveLine('link')}
    />
  );

  return (
    <div className={styles.stack}>
      {leadsWithAddress && linkBox}

      <ProfileManageSectionMolecule
        id='profile-identity'
        title={t('identitySection')}
        status={saveLine('identity')}>
        {/* The profile photo stands BEFORE the text fields: it is the first thing the client sees on the
            card, and its save is not an autosave (own mutation + crop), so it does not mix with sections. */}
        <StylistAvatarFieldOrganism />
        <StylistPublicNameFieldMolecule stylistAccount={stylistAccount} />
        <div className={styles.field}>
          <InputAtom
            label={t('businessNameLabel')}
            value={salonName}
            onChange={e =>
              setSalonName(
                e.target.value.slice(0, VALIDATION_LENGTHS.BUSINESS_NAME_MAX)
              )
            }
            maxLength={VALIDATION_LENGTHS.BUSINESS_NAME_MAX}
            onBlur={() => inBox('identity', saveBusinessName)}
            onKeyDown={blurOnEnter}
          />
        </div>
        <PublicBioEditorOrganism
          stylistAccount={stylistAccount}
          showProfileLink={false}
        />
      </ProfileManageSectionMolecule>

      <StylistProfileLocationBoxMolecule
        values={{ city, street, country }}
        setters={{ setCity, setStreet }}
        onCountryChange={next => {
          chooseCountry(next);
          inBox('location', () => saveLocation(next));
        }}
        sharedWithSalon={hasOwnSalon(stylistAccount)}
        cityError={streetNeedsCity ? t('locationCityRequired') : undefined}
        onCommit={() => inBox('location', () => saveLocation())}
        onKeyDown={blurOnEnter}
        saveLine={saveLine('location')}
      />

      <StylistProfileContactBoxMolecule
        values={{ phone, website, instagram, links }}
        setters={{ setPhone, setWebsite, setInstagram, setLinks }}
        sharedWithSalon={hasOwnSalon(stylistAccount)}
        instagramError={
          failedSections.has('social') ? t('fieldNotSaved') : undefined
        }
        onCommitLocation={() => inBox('contact', saveContact)}
        onCommitInstagram={() => inBox('contact', saveInstagram)}
        onCommitLinks={next => inBox('contact', () => saveLinks(next))}
        onKeyDown={blurOnEnter}
        saveLine={saveLine('contact')}
      />

      {!leadsWithAddress && linkBox}

      <ProfileManageSectionMolecule
        id='profile-colour'
        title={t('brandingLabel')}>
        <StylistBrandColorFieldOrganism
          value={accentColor}
          savedValue={stylistAccount.brand_accent_color ?? ''}
          canBrand={canBrand}
          isPending={isBusy('branding')}
          hasFailed={failedSections.has('branding')}
          onSelect={saveAccent}
        />
      </ProfileManageSectionMolecule>
    </div>
  );
}
