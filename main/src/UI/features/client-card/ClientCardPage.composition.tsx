import { getEffectivePricingPlan } from '@kernel/domain/pricing/effective-plan';
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { capturePosthog } from '../../../application/analytics/posthog-client';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { canStartTrial } from '@kernel/domain/pricing/pricing-policy';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { isIOError } from '../../../application/http/toPromise.adapter';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { buildPlanPayDeepLink } from '../shared/pricing/pricingFunnelHref';
import { usePurchaseResumeCapture } from '../shared/upsell/usePurchaseResumeCapture';
import { useClientContactForStylist } from './hooks/useClientContactForStylist';
import {
  useClientCrmNote,
  useDeleteClientCrmNote,
  useUpsertClientCrmNote,
} from '../shared/client-card/hooks/useClientCrmNote';
import { useClientVisits } from './hooks/useClientVisits';
import {
  useCreateManualVisit,
  useDeleteManualVisit,
  useRemoveVisitResultPhoto,
  useUpdateVisitNote,
} from './hooks/useVisitMutations';
import { ClientCardLockedOrganism } from './ClientCardPage.locked.organism';
import { ImportantNoteSectionOrganism } from './ClientCardPage.important-note.organism';
import { useClientImportantNote } from '../shared/notes/hooks/useClientImportantNote';
import { CrmNoteSectionOrganism } from './ClientCardPage.crm-note.organism';
import {
  ClientProfileHeroOrganism,
  ContactSectionOrganism,
} from './ClientCardPage.parts.organism';
import { HistorySectionOrganism } from './ClientCardPage.history.organism';
import { ExpiredSessionsMolecule } from './ClientCardPage.expired-sessions.molecule';
import { ManualVisitComposerMolecule } from './ClientCardPage.manual-visit.molecule';
import styles from './ClientCardPage.module.css';

function readClientId(queryValue: string | string[] | undefined): string {
  if (Array.isArray(queryValue)) {
    return queryValue[0] ?? '';
  }
  return queryValue ?? '';
}

function ClientCardPageInner({ clientUserId }: { clientUserId: string }) {
  const t = useTranslations('clientCard');
  const tButtons = useTranslations('buttons');
  const tEvents = useTranslations('events');
  const router = useRouter();
  const { data: user, isLoading: userLoading } = useCurrentUserAccount();
  const captureResume = usePurchaseResumeCapture();
  const currentPlan = user?.stylist_account
    ? getEffectivePricingPlan(user.stylist_account)
    : PricingPlanValue.FREE;
  const planConfig = PRICING_POLICY.utils.getPlanConfig(currentPlan);
  const hasCardAccess = PRICING_POLICY.utils.canViewHistory(planConfig);
  const availability = useClientImportantNote(
    user !== undefined && clientUserId !== '' ? clientUserId : null
  );
  const unavailable =
    isIOError(availability.error) &&
    availability.error.httpError.event ===
      APP_EVENTS.INFO.CLIENT.NOT_PAIRED_WITH_CLIENT;
  const availabilityConfirmed = availability.data !== undefined && !unavailable;
  const privateReadsEnabled = hasCardAccess && availabilityConfirmed;
  const showLocked =
    !userLoading &&
    user !== undefined &&
    !hasCardAccess &&
    clientUserId !== '' &&
    availabilityConfirmed;

  const contact = useClientContactForStylist(clientUserId, privateReadsEnabled);
  const crmNote = useClientCrmNote(clientUserId, privateReadsEnabled);
  const visits = useClientVisits(clientUserId, privateReadsEnabled);
  const upsertNote = useUpsertClientCrmNote(clientUserId);
  const deleteNote = useDeleteClientCrmNote(clientUserId);
  const createManualVisit = useCreateManualVisit(clientUserId);
  const updateVisitNote = useUpdateVisitNote(clientUserId);
  const removePhoto = useRemoveVisitResultPhoto(clientUserId);
  const deleteManualVisit = useDeleteManualVisit(clientUserId);

  const title = availabilityConfirmed
    ? (contact.data?.client_name ?? t('title'))
    : t('title');
  useAppBarTitle(title);
  const trialAvailable = canStartTrial({
    trialStartedAt: user?.stylist_account?.trial_started_at,
    paymentStatus: user?.stylist_account?.payment_status,
  });
  const payHref = buildPlanPayDeepLink(PricingPlanValue.PRO, 'month');

  useEffect(() => {
    if (showLocked) {
      capturePosthog('upgrade_prompt_shown', {
        trigger: 'client_card',
        current_plan: currentPlan,
      });
    }
  }, [currentPlan, showLocked]);

  const visitItems = visits.visits;
  const retentionDays = visits.historyAccess?.retentionDays ?? null;
  const hasMoreVisits = visits.hasNextPage === true;
  // Wizyty przychodzą posortowane malejąco (najnowsza pierwsza) — pierwszy
  // element = ostatnia wizyta, materiał na żywe meta hero.
  const lastVisitDate = visitItems[0]?.visitDate ?? null;

  // DECISION: guard on `user === undefined`, NOT on `userLoading`. useCurrentUserAccount has
  // enabled=hasSessionToken(): on SSR localStorage is unavailable, so the query is disabled and TQ
  // v5 reports isLoading=false (fetchStatus 'idle'); the server would render the FULL card while
  // the client (token in localStorage, enabled, isLoading=true) renders the skeleton: a hydration
  // mismatch. `user === undefined` agrees on SSR and client (data has not arrived in both) and
  // removes isLoading/isPending flakiness. The page lives behind the AppLayout auth guard, so user
  // always resolves (no endless-skeleton risk).
  if (
    user === undefined ||
    clientUserId === '' ||
    (!availability.isError && !availabilityConfirmed)
  ) {
    return (
      // Same boxes as the loaded card: intro, main action, note, one visit.
      <div className={styles.page} aria-hidden='true'>
        <SkeletonAtom variant='rect' width='100%' height={124} />
        <SkeletonAtom variant='rect' width='100%' height={44} />
        <SkeletonAtom variant='rect' width='100%' height={228} />
        <SkeletonAtom variant='rect' width='100%' height={180} />
      </div>
    );
  }

  if (availability.isError && !availabilityConfirmed) {
    return (
      <div className={styles.page}>
        <AppHeroOrganism title={t('title')} />
        {unavailable ? (
          <>
            <ErrorStateMolecule
              message={tEvents(APP_EVENTS.INFO.CLIENT.NOT_PAIRED_WITH_CLIENT)}
            />
            <LinkButtonAtom href={ROUTES_FRONT.CLIENTS} variant='outlined'>
              {t('unavailableAction')}
            </LinkButtonAtom>
          </>
        ) : (
          <ErrorStateMolecule
            message={t('importantNoteLoadError')}
            retryLabel={tButtons('retry')}
            onRetry={() => void availability.refetch()}
            isRetrying={availability.isFetching}
          />
        )}
      </div>
    );
  }

  // DECISION: „Ważne przed wizytą” is safety information, so it stands at the top of the card on
  // EVERY plan, above the plan lock on Free (owner; no plan gate on the backend).
  if (showLocked) {
    return (
      <div className={styles.page}>
        <ImportantNoteSectionOrganism
          key={clientUserId}
          clientUserId={clientUserId}
        />
        <ClientCardLockedOrganism
          trialAvailable={trialAvailable}
          onCta={() => {
            captureResume({ kind: 'client', clientId: clientUserId });
            void router.push(payHref);
          }}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <ClientProfileHeroOrganism
        contact={contact.data}
        visitCount={visitItems.length}
        visitCountIsLowerBound={hasMoreVisits}
        lastVisitDate={lastVisitDate}
      />
      <ImportantNoteSectionOrganism
        key={clientUserId}
        clientUserId={clientUserId}
      />
      {/* DECISION: order of the card: the ONE main action (add a visit) right under the intro,
          then what the stylist reads before the visit (her note), then the history. Contact is
          reference data: second column from 720px of own width, last on a phone. */}
      <PageColumnsMolecule
        main={
          <>
            <ManualVisitComposerMolecule
              isPending={createManualVisit.isPending}
              onCreate={payload => createManualVisit.mutateAsync(payload)}
            />
            <CrmNoteSectionOrganism
              key={clientUserId}
              initialNote={crmNote.data?.note}
              updatedAt={crmNote.data?.updatedAt}
              isLoading={crmNote.isLoading}
              isError={crmNote.isError}
              onRetry={() => void crmNote.refetch()}
              isRetrying={crmNote.isFetching}
              isSaving={upsertNote.isPending}
              isSaveError={upsertNote.isError}
              saveError={upsertNote.error}
              isSaveSuccess={upsertNote.isSuccess}
              savedNote={upsertNote.data}
              resetSave={upsertNote.reset}
              fetchCurrent={async () => {
                const result = await crmNote.refetch();
                if (result.isError || result.data === undefined) {
                  throw new Error('note fetch failed');
                }
                return result.data;
              }}
              isDeleting={deleteNote.isPending}
              isDeleteError={deleteNote.isError}
              onSave={(note, expectedUpdatedAt, exactRevision) =>
                upsertNote.mutate({
                  note,
                  expectedUpdatedAt,
                  ...(exactRevision ? { exactRevision: true } : {}),
                })
              }
              onDelete={() => deleteNote.mutate()}
            />
            <HistorySectionOrganism
              visits={visitItems}
              clientUserId={clientUserId}
              isLoading={visits.isLoading}
              isError={visits.isError}
              hasData={visits.hasData}
              isLoadMoreError={visits.isFetchNextPageError}
              hasMore={hasMoreVisits}
              isLoadingMore={visits.isFetchingNextPage}
              onLoadMore={() => void visits.fetchNextPage()}
              retentionDays={retentionDays}
              onUpdateNote={(visitId, note) =>
                updateVisitNote.mutateAsync({
                  visit_id: visitId,
                  service_note: note,
                })
              }
              onRemovePhoto={(visitId, photoId) =>
                removePhoto.mutateAsync({
                  visit_id: visitId,
                  photo_id: photoId,
                })
              }
              onDeleteVisit={visitId =>
                deleteManualVisit.mutateAsync({ visit_id: visitId })
              }
              onRetry={() => void visits.refetch()}
              isRetrying={visits.isFetching || visits.isFetchingNextPage}
            />
            <ExpiredSessionsMolecule sessions={visits.expiredSessions} />
          </>
        }
        aside={
          <ContactSectionOrganism
            contact={contact.data}
            isLoading={contact.isLoading}
            isError={contact.isError && contact.data === undefined}
            onRetry={() => void contact.refetch()}
            isRetrying={contact.isFetching}
          />
        }
      />
    </div>
  );
}

export function ClientCardPageComposition({
  clientUserId: initialClientUserId,
}: {
  clientUserId?: string;
}) {
  const router = useRouter();
  const clientUserId = initialClientUserId ?? readClientId(router.query.id);

  return (
    <AppLayoutComposition>
      <ClientCardPageInner clientUserId={clientUserId} />
    </AppLayoutComposition>
  );
}
