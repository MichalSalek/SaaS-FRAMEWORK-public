// UI/features/notes/NotesPage.composition.tsx
// „Notatki” (/app/notes): the stylist's private notes in one place (owner
// 2026-10-21). Her general note (the field that used to stand on the dashboard),
// her notes about clients, the notes of Inspiration Sessions and visit notes,
// filterable by client. Every row opens the screen the note lives on. STYLIST
// screen: a client is sent to her dashboard.
//
// Feedback: the read is silent on failure (error-feedback.policy) and the screen
// renders the error inline with a retry; the general note keeps its own save line.

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { LockSimpleIcon } from '@phosphor-icons/react';
import { canStartTrial } from '@kernel/domain/pricing/pricing-policy';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import {
  getFromClientStorage,
  setToClientStorage,
} from '../../../application/client-device-storage/clientStorage.possibilities.api';
import { noteBioBridgeKey } from '../../../application/client-device-storage/storage-keys.config';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { useAppRole } from '../../layouts/useAppRole';
import { useNativeRouter } from '../../layouts/useNativeRouter';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { NavRowListSkeletonMolecule } from '../../components/NavRow/NavRow.molecule';
import { SelectAtom } from '../../components/Select/Select.atom';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { useUrlSyncedState } from '../../shared/hooks/useUrlSyncedState';
import { DashboardNoteOrganism } from '../shared/notes/DashboardNote.organism';
import { useDashboardNote } from '../shared/notes/hooks/useDashboardNote';
import { buildPlanPayDeepLink } from '../shared/pricing/pricingFunnelHref';
import { NotesListsOrganism } from './components/NotesLists.organism';
import { NoteToBioBridgeOrganism } from './components/NoteToBioBridge.organism';
import { usePrivateNotes } from './hooks/usePrivateNotes';
import { shouldOfferNoteAsBio } from './notes-presentation';
import styles from './NotesPage.module.css';

const ALL_CLIENTS = 'all';

const NOTES_URL_CODEC = {
  keys: ['client'] as const,
  parse: (query: Record<string, string | string[] | undefined>) => {
    const raw = query['client'];
    return typeof raw === 'string' && raw !== '' ? raw : ALL_CLIENTS;
  },
  build: (client: string): Record<string, string> =>
    client === ALL_CLIENTS ? {} : { client },
};

function NotesPageInner() {
  const t = useTranslations('pages.notes');
  const tButtons = useTranslations('buttons');
  const locale = useLocale();
  useAppBarTitle(t('title'));
  const router = useNativeRouter();
  const { role, isRoleResolved } = useAppRole();
  const { data: user } = useCurrentUserAccount();
  const stylistAccount = user?.stylist_account ?? null;

  // Same rule as the clients list: decide only once the role is RESOLVED
  // (before that it reads as 'client'); a client has no notes screen.
  const isClient = isRoleResolved && role === 'client';
  useEffect(() => {
    if (isClient) {
      router.replace(ROUTES_FRONT.APP);
    }
  }, [isClient, router]);

  const [client, setClient] = useUrlSyncedState(NOTES_URL_CODEC);
  const clientFilter = client === ALL_CLIENTS ? null : client;
  const canRead = isRoleResolved && !isClient && stylistAccount !== null;
  const notes = usePrivateNotes(clientFilter, canRead);
  const generalNote = useDashboardNote(AccountTypeValue.STYLIST);

  // The note-as-profile-text offer: decided ONCE, when both the note and the
  // account are known, then latched, so saving the profile text (which empties
  // the condition) does not pull the card away from under its own success line.
  const [offerOpen, setOfferOpen] = useState<boolean | null>(null);
  useEffect(() => {
    if (
      offerOpen !== null ||
      stylistAccount === null ||
      generalNote.isLoading ||
      generalNote.loadFailed
    ) {
      return;
    }
    setOfferOpen(
      shouldOfferNoteAsBio({
        generalNote: generalNote.note,
        description: stylistAccount.description,
        answered:
          getFromClientStorage({
            key: noteBioBridgeKey(stylistAccount.account_id),
          }) !== null,
      })
    );
  }, [offerOpen, stylistAccount, generalNote]);
  const rememberAnswer = () => {
    if (stylistAccount !== null) {
      setToClientStorage({
        key: noteBioBridgeKey(stylistAccount.account_id),
        value: new Date().toISOString(),
      });
    }
  };

  const trialAvailable = canStartTrial({
    trialStartedAt: stylistAccount?.trial_started_at,
    paymentStatus: stylistAccount?.payment_status,
  });
  const payHref = buildPlanPayDeepLink(PricingPlanValue.PRO, 'month');

  const data = notes.data;
  const clients = data?.clients ?? [];
  // A filter for a client who has no note any more (shared link, a note just
  // emptied) still names her, so the select never shows a blank.
  const filterOptions = [
    { value: ALL_CLIENTS, label: t('filterAll') },
    ...clients.map(item => ({
      value: item.client_user_id,
      label: item.name?.trim() || t('unnamedClient'),
    })),
    ...(clientFilter !== null &&
    !clients.some(item => item.client_user_id === clientFilter)
      ? [{ value: clientFilter, label: t('unnamedClient') }]
      : []),
  ];

  const renderLists = () => {
    if (notes.isError && data === undefined) {
      return (
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={tButtons('retry')}
          onRetry={() => void notes.refetch()}
          isRetrying={notes.isFetching}
        />
      );
    }
    if (data === undefined) {
      return <NavRowListSkeletonMolecule leading rows={3} lines={2} />;
    }
    return (
      <NotesListsOrganism
        data={data}
        isFiltered={clientFilter !== null}
        trialAvailable={trialAvailable}
        payHref={payHref}
      />
    );
  };

  return (
    <div className={styles.page} lang={locale}>
      <AppHeroOrganism title={t('title')} />
      <p className={styles.privacy}>
        <span className={styles.privacyIcon} aria-hidden='true'>
          <LockSimpleIcon size={18} />
        </span>
        <span>{t('privacyLine')}</span>
      </p>

      {offerOpen === true &&
        stylistAccount !== null &&
        generalNote.note !== null && (
          <NoteToBioBridgeOrganism
            stylistAccount={stylistAccount}
            note={generalNote.note}
            onAnswered={rememberAnswer}
            onDismiss={() => {
              rememberAnswer();
              setOfferOpen(false);
            }}
          />
        )}

      <DashboardNoteOrganism
        accountType={AccountTypeValue.STYLIST}
        copy={{
          title: t('generalTitle'),
          placeholder: t('generalPlaceholder'),
          hint: t('generalHint'),
        }}
      />

      {clients.length > 0 && (
        <SelectAtom
          label={t('filterLabel')}
          options={filterOptions}
          value={client}
          onValueChange={setClient}
          className={styles.filter}
        />
      )}

      {canRead || notes.isError ? (
        renderLists()
      ) : (
        <NavRowListSkeletonMolecule leading rows={3} lines={2} />
      )}
    </div>
  );
}

export function NotesPageComposition() {
  const t = useTranslations('pages.notes');
  return (
    <AppLayoutComposition title={t('title')}>
      <NotesPageInner />
    </AppLayoutComposition>
  );
}
