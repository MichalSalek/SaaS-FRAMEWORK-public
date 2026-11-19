// UI/features/salon-profile/SalonProfileEditor.organism.tsx
// A PUBLISHED salon profile: every field saves itself, the same way as the
// stylist's own profile (StylistProfileSection). DECISION in
// SalonProfileManage.organism.tsx.

import { useCallback, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getSalonProfilePath } from '@kernel/domain/salon-profile/salon.urls';
import { isUnlimitedLimit } from '@kernel/policies/pricing.policy';
import type { SalonProfileData } from '@kernel/models/salon-profile/salon-profile.dto';
import { getSalonStaff_IO } from '../../../domain/salon-staff/salonStaffIO.possibilities.api';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import { OutcomeStateMolecule } from '../../components/OutcomeFeedback/OutcomeState.molecule';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import { useProfileCountry } from '../shared/location/useProfileCountry';
import { useLeaveGuard } from '../../shared/hooks/useLeaveGuard';
import { useUsageStats } from '../shared/account/hooks/useUsageStats';
import { ProfileLinkCardOrganism } from '../shared/profile/ProfileLinkCard.organism';
import { ProfileManageSectionMolecule } from '../shared/profile/ProfileManageSection.molecule';
import { useSingleFlightSaves } from '../shared/profile/hooks/useSingleFlightSaves';
import { SalonGalleryOrganism } from './SalonGallery.organism';
import { SalonQrOrganism } from './SalonQr.organism';
import {
  salonEditorSaveLine,
  salonTapSaveLine,
} from './SalonTapSaveLine.molecule';
import {
  SalonBrandSectionMolecule,
  SalonContactSectionMolecule,
  SalonLocationSectionMolecule,
  SalonIdentitySectionMolecule,
  SalonTeamSectionMolecule,
} from './SalonSetupFields.molecule';
import { useSalonSlugField } from './useSalonSlugField';
import {
  initialDraft,
  blurSalonInputOnEnter,
  salonStreetNeedsCity,
  salonDraftDirty,
  type SalonDraft,
  type SalonUpdateRequest,
} from './salonProfileDraft';
import { useSalonEditorCommit } from './useSalonEditorCommit';
import { saveSalonEditor } from './mergeSalonEditorSave';
import { StylistAvatarFieldOrganism } from '../shared/profile/photo/StylistAvatarField.organism';
import styles from './SalonProfileManage.module.css';

/** The box whose control started the latest save: its line reports it. */
type Box = 'identity' | 'location' | 'contact' | 'colour' | 'team' | 'works';

export function SalonProfileEditorOrganism({
  profile,
  justPublished,
}: {
  profile: SalonProfileData;
  /** The one-time „Opublikuj” has just succeeded on this screen. */
  justPublished: boolean;
}) {
  const t = useTranslations('salon.profile');
  const setup = useTranslations('salon.setup');
  const tBrand = useTranslations('account.profile');
  const tAvatar = useTranslations('account.avatar');
  const cache = useQueryClient();
  const rosterQuery = useQuery({
    queryKey: queryKeys.staff.members,
    queryFn: ({ signal }) => getSalonStaff_IO(undefined, { signal }),
  });
  const { data: usage } = useUsageStats();

  // Never re-seed inputs on response: another field may be mid-edit.
  const [saved, setSaved] = useState(profile);
  const savedRef = useRef(profile);
  const start = initialDraft(profile);
  const [name, setName] = useState(start.name);
  const [slug, setSlug] = useState(start.slug);
  const [contact, setContact] = useState(start.contact);
  const { country, chooseCountry, adoptCountryIfCurrent } = useProfileCountry(
    profile.contact.address_country,
    profile.account_id
  );
  const [accent, setAccent] = useState(start.accent);
  const [showTeam, setShowTeam] = useState(start.showTeam);
  const [pins, setPins] = useState(start.pins);
  const [limitHit, setLimitHit] = useState(false);
  const [savingBox, setSavingBox] = useState<Box | null>(null);
  // Every snapshot carries the committed link, including while it is queued.
  const committedSlugRef = useRef(profile.salon_vanity_url ?? '');
  const draftRef = useRef<SalonDraft>(start);
  const pendingPatchesRef = useRef<SalonUpdateRequest>({});
  draftRef.current = {
    contact: { ...contact, address_country: country },
    slug,
    name,
    accent,
    showTeam,
    pins,
  };

  const savedSlug = saved.salon_vanity_url ?? '';
  const slugField = useSalonSlugField(slug, savedSlug || null, saved);

  const saves = useSingleFlightSaves<'salon', SalonUpdateRequest>(request =>
    saveSalonEditor(request, {
      pending: pendingPatchesRef,
      draft: draftRef,
      saved: savedRef,
      committedSlug: committedSlugRef,
      setSaved,
      setters: [
        setName,
        setSlug,
        setContact,
        setAccent,
        setShowTeam,
        setPins,
        adoptCountryIfCurrent,
      ],
      cache,
    })
  );

  const rememberSlug = useCallback((value: string) => {
    committedSlugRef.current = value;
  }, []);
  const { commit, leaveSlug, retry } = useSalonEditorCommit({
    savedRef,
    committedSlugRef,
    rememberSlug,
    draftRef,
    slug,
    slugValid: slugField.validSlug,
    slugState: slugField.state,
    saves,
    setSavingBox,
    pendingPatchesRef,
  });

  const failed = saves.failedSections.has('salon');
  const slugPending = slug !== committedSlugRef.current;
  useLeaveGuard({
    when: saves.isSaving || failed || slugPending,
    message: t('unsaved'),
  });

  const pinLimit =
    usage && !isUnlimitedLimit(usage.limits.max_pinned_records)
      ? usage.limits.max_pinned_records
      : null;

  const streetNeedsCity = salonStreetNeedsCity(draftRef.current.contact);
  const dirty: Partial<Record<Box, boolean>> = salonDraftDirty(
    draftRef.current,
    saved,
    slugPending,
    slugField.isError
  );
  const saveLine = (box: Box) =>
    salonEditorSaveLine(
      `${saved.account_id}-${box}`,
      saves.isSaving && savingBox === box,
      dirty[box] === true,
      failed && savingBox === box,
      retry
    );
  const quietLine = (box: Box) =>
    salonTapSaveLine(savingBox === box, saves.isSaving, failed, retry);

  const publicPath = getSalonProfilePath({
    ...saved,
    salon_vanity_url: savedSlug || null,
  });
  const pinCounter =
    pinLimit === null
      ? String(pins.length)
      : t('showcaseCounter', { count: pins.length, limit: pinLimit });

  const fields = (
    <div className={styles.setup}>
      <ProfileManageSectionMolecule
        id='salon-logo'
        title={tAvatar('logoLabel')}>
        <StylistAvatarFieldOrganism target='logo' logoUrl={profile.logo_url} />
      </ProfileManageSectionMolecule>
      <SalonIdentitySectionMolecule
        name={name}
        setName={setName}
        nameError={name.trim() ? undefined : t('nameRequired')}
        slug={slug}
        setSlug={setSlug}
        slugPreview={slugField.preview}
        slugMessage={slugField.message}
        slugError={slugField.isError}
        published
        commit={{
          name: {
            onBlur: () => commit('identity'),
            onKeyDown: blurSalonInputOnEnter,
          },
          slug: { onBlur: leaveSlug, onKeyDown: blurSalonInputOnEnter },
        }}
        status={saveLine('identity')}
      />
      <SalonLocationSectionMolecule
        contact={draftRef.current.contact}
        setContact={setContact}
        onCountryChange={next => {
          chooseCountry(next);
          commit('location', {
            contact: { ...draftRef.current.contact, address_country: next },
          });
        }}
        cityError={streetNeedsCity ? tBrand('locationCityRequired') : undefined}
        commit={{
          onBlur: () => commit('location'),
          onKeyDown: blurSalonInputOnEnter,
        }}
        status={saveLine('location')}
      />
      <SalonContactSectionMolecule
        contact={contact}
        setContact={setContact}
        onCommitLinks={next =>
          commit('contact', {
            contact: { ...draftRef.current.contact, external_links: next },
          })
        }
        commit={{
          onBlur: () => commit('contact'),
          onKeyDown: blurSalonInputOnEnter,
        }}
        status={saveLine('contact')}
      />
      <SalonBrandSectionMolecule
        accent={accent}
        onSelect={next => {
          setAccent(next);
          commit('colour', { accent: next });
        }}
        status={quietLine('colour')}
      />
      <SalonTeamSectionMolecule
        showTeam={showTeam}
        setShowTeam={next => {
          setShowTeam(next);
          commit('team', { showTeam: next });
        }}
        roster={{
          hasData: rosterQuery.data !== undefined,
          members: rosterQuery.data?.staff ?? [],
        }}
        status={quietLine('team')}
      />
    </div>
  );

  const works = (
    <ProfileManageSectionMolecule
      id='salon-showcase'
      title={t('works')}
      meta={pinCounter}
      description={t('worksHelp')}
      status={quietLine('works')}>
      <SalonGalleryOrganism
        salonAccountId={saved.account_id}
        selection={{
          ids: pins,
          notice:
            limitHit && pinLimit !== null
              ? t('showcaseLimitReached', { limit: pinLimit })
              : null,
          onToggle: (id, selected) => {
            if (selected && pinLimit !== null && pins.length >= pinLimit) {
              setLimitHit(true);
              return;
            }
            setLimitHit(false);
            const nextPins = selected
              ? [...draftRef.current.pins, id]
              : draftRef.current.pins.filter(value => value !== id);
            draftRef.current = { ...draftRef.current, pins: nextPins };
            setPins(nextPins);
            commit('works', { pins: nextPins });
          },
        }}
      />
    </ProfileManageSectionMolecule>
  );

  return (
    <div className={styles.setup}>
      <ProfileLinkCardOrganism
        target='salon'
        viewPath={publicPath}
        sharePath={publicPath}
        {...(justPublished && {
          outcome: (
            <OutcomeStateMolecule confirmed message={setup('published')} />
          ),
        })}
      />
      <PageColumnsMolecule
        asideSize='wide'
        narrowFirst='main'
        main={works}
        aside={fields}
      />
      <SalonQrOrganism />
    </div>
  );
}
