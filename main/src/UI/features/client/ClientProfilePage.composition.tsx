// UI/features/client/ClientProfilePage.composition.tsx
// The client's own profile: who she is, her connected stylists, the contact
// data she shares with them and the doors to her sessions and account.
// Route: /app/client-profile
//
// DECISION: the "Twoje preferencje" section stored nothing and is switched off behind
// CLIENT_PREFERENCES_ENABLED (clientProfile.config.ts lists what must exist before it returns). The
// screen opens with what is real.

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { formatMonthYear } from '../../../application/date/date.utils';
import { useCurrentUser } from '../../contexts/AuthContext.composition';

import { usePairedList } from '../shared/pairing/hooks/usePairedList';
import { isPairedStylist } from '../../../domain/pairing/pairing.types';
import { useClientProfileQuery } from './hooks/useClientProfileQuery';
import { useUpdateClientContact } from './hooks/useUpdateClientContact';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import { CLIENT_PREFERENCES_ENABLED } from './clientProfile.config';
import {
  ClientProfileHeroOrganism,
  ClientProfileSkeletonOrganism,
} from './ClientProfilePage.parts.organism';
import { ClientProfilePreferencesOrganism } from './ClientProfilePreferences.organism';
import { PairedStylistsStripOrganism } from './ClientProfilePaired.parts.organism';
import { ContactCardOrganism } from './ClientProfileContactCard.organism';
import { SettingsShortcutsOrganism } from './ClientProfileSettings.parts.organism';
import styles from './ClientProfilePage.module.css';

/* ------------------------------------------------------------------ */
/*  Inner component (owns data)                                        */
/* ------------------------------------------------------------------ */

function ClientProfilePageInner() {
  const t = useTranslations('pages.clientProfile');
  const tMenu = useTranslations('menu');
  const tLabels = useTranslations('labels');
  const tButtons = useTranslations('buttons');

  useAppBarTitle(tMenu('clientProfile'));

  const { user, isLoading: isUserLoading } = useCurrentUser();
  const {
    data: profile,
    isLoading: isProfileLoading,
    isError,
    isFetching: isProfileFetching,
    refetch: refetchProfile,
  } = useClientProfileQuery();
  const {
    pairs: rawPairs,
    data: pairsData,
    isLoading: isPairsLoading,
    isError: isPairsError,
    isFetching: isPairsFetching,
    refetch: refetchPairs,
  } = usePairedList();
  // Narrow the union — a client account only sees stylist-shaped pairs.
  const pairs = rawPairs.filter(isPairedStylist);
  const updateContactMutation = useUpdateClientContact();

  /* -- Contact form local state -- */
  const [isEditing, setIsEditing] = useState(false);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [savedState, setSavedState] = useState({ phone: '', email: '' });

  // isEditing read via a ref, NOT an effect dep, so the seed runs ONLY when the
  // server `profile` reference changes — never on the isEditing toggle. Gating the
  // effect on isEditing directly re-seeds on the save transition (true→false) while
  // `profile` is still the pre-refetch value, flashing the field back to its old
  // value for a paint. The ref still blocks a background refetch from clobbering
  // in-progress input mid-edit (profile-ref change while editing → guard skips).
  const isEditingRef = useRef(isEditing);
  isEditingRef.current = isEditing;

  useEffect(() => {
    if (profile && !isEditingRef.current) {
      setPhone(profile.contact_phone ?? '');
      setEmail(profile.contact_email ?? '');
    }
  }, [profile]);

  /* -- Contact actions -- */
  const handleEdit = () => {
    updateContactMutation.reset();
    setSavedState({ phone, email });
    setIsEditing(true);
  };

  const handleCancel = () => {
    setPhone(savedState.phone);
    setEmail(savedState.email);
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (
      phone.trim() === savedState.phone &&
      email.trim() === savedState.email
    ) {
      setIsEditing(false);
      return;
    }
    // PATCH contract (backend updateClientContact_IO): non-empty string = set,
    // '' = explicit clear (→ null), omitted = leave untouched. We must send ''
    // (not omit) for a field that WAS set but is now emptied, otherwise clearing
    // a previously-saved phone/email silently no-ops. savedState holds the
    // pre-edit values (captured in handleEdit).
    const payload: Record<string, string> = {};
    const trimmedPhone = phone.trim();
    const trimmedEmail = email.trim();
    if (trimmedPhone || savedState.phone) {
      payload.contact_phone = trimmedPhone;
    }
    if (trimmedEmail || savedState.email) {
      payload.contact_email = trimmedEmail;
    }
    // DECISION: no local error toast, the HTTP interceptor owns it (three toast layers:
    // main/src/application/http/queryClient.config.ts). try/catch only drives the edit state.
    try {
      // Re-sync form state from the SERVER response (sanitised values may
      // differ from raw input, e.g. trimmed/normalised phone) so the displayed
      // value matches persisted immediately, not only after the background
      // invalidation refetch lands.
      const result = await updateContactMutation.mutateAsync(payload);
      setPhone(result.contact_phone ?? '');
      setEmail(result.contact_email ?? '');
      setIsEditing(false);
    } catch {
      // The toast belongs to the interceptor; the form stays in edit mode with the typed values, so
      // they can be corrected and retried.
    }
  };

  /* -- Derived -- */
  const displayName = user?.name ?? tLabels('clientFallback');

  const locale = useLocale();
  const memberSinceLabel = ((): string | undefined => {
    if (!profile?.created_at) {
      return undefined;
    }
    try {
      const d = new Date(profile.created_at);
      if (Number.isNaN(d.getTime())) {
        return undefined;
      }
      // DECISION: pass the locale explicitly, never undefined: the runtime default is Node SSR 'en'
      // vs CSR 'pl', a hydration mismatch. formatMonthYear gives the genitive for pl ("czerwca
      // 2026", not "czerwiec"), which the phrase "od {date}" needs after the preposition.
      const formatted = formatMonthYear(d, locale);
      return t('memberSince', { date: formatted });
    } catch {
      return undefined;
    }
  })();

  const isLoading = isProfileLoading || isUserLoading || isPairsLoading;
  const isSaving = updateContactMutation.isPending;

  /* -- Loading state -- */
  if (isLoading) {
    return <ClientProfileSkeletonOrganism />;
  }

  /* -- Error state -- */
  // Only without a cached profile: a failed background refetch keeps `data`
  // (TQ v5) and must not replace a working screen (or an open contact edit).
  if (isError && !profile) {
    return (
      <div className={styles.page}>
        <ErrorStateMolecule
          message={t('errors.cannotFetch')}
          retryLabel={tButtons('retry')}
          onRetry={() => void refetchProfile()}
          isRetrying={isProfileFetching}
        />
      </div>
    );
  }

  // One filled action per screen: with no stylist yet it is pairing, with a
  // stylist it is keeping the contact data she sees up to date.
  const pairsUnknown =
    isPairsError && (pairsData === undefined || pairs.length === 0);
  const hasStylists = !pairsUnknown && pairs.length > 0;

  return (
    <div className={styles.page}>
      <ClientProfileHeroOrganism
        displayName={displayName}
        {...(memberSinceLabel !== undefined && { memberSinceLabel })}
      />

      {CLIENT_PREFERENCES_ENABLED && <ClientProfilePreferencesOrganism />}

      <PageColumnsMolecule
        main={
          <>
            <PairedStylistsStripOrganism
              pairs={pairs}
              // An EMPTY cached list under a failed refetch is unconfirmed
              // too: retry, not the "pair with a stylist" empty state.
              loadFailed={pairsUnknown}
              onRetry={() => void refetchPairs()}
              isRetrying={isPairsFetching}
              pairIsMainAction={!isEditing}
            />
            <ContactCardOrganism
              email={email}
              phone={phone}
              isEditing={isEditing}
              isSaving={isSaving}
              saveState={
                isSaving
                  ? 'pending'
                  : updateContactMutation.isError
                    ? 'error'
                    : isEditing &&
                        (phone !== savedState.phone ||
                          email !== savedState.email)
                      ? 'dirty'
                      : updateContactMutation.isSuccess
                        ? 'complete'
                        : 'idle'
              }
              editIsMainAction={hasStylists}
              onEmailChange={setEmail}
              onPhoneChange={setPhone}
              onEdit={handleEdit}
              onSave={() => void handleSave()}
              onCancel={handleCancel}
            />
          </>
        }
        aside={<SettingsShortcutsOrganism />}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shell with AppLayout                                               */
/* ------------------------------------------------------------------ */

export function ClientProfilePageComposition() {
  const tMenu = useTranslations('menu');
  return (
    <AppLayoutComposition title={tMenu('clientProfile')}>
      <ClientProfilePageInner />
    </AppLayoutComposition>
  );
}
