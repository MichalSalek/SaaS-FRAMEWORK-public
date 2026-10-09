import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import posthog from 'posthog-js';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { canStartTrial } from '@kernel/domain/pricing/pricing-policy';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { buildPlanPayDeepLink } from '../shared/pricing/pricingFunnelHref';
import { useClientContactForStylist } from './hooks/useClientContactForStylist';
import {
  useClientCrmNote,
  useDeleteClientCrmNote,
  useUpsertClientCrmNote,
} from './hooks/useClientCrmNote';
import { useClientVisits } from './hooks/useClientVisits';
import {
  useCreateManualVisit,
  useDeleteManualVisit,
  useRemoveVisitResultPhoto,
  useUpdateVisitNote,
} from './hooks/useVisitMutations';
import { ClientCardLockedOrganism } from './ClientCardPage.locked.organism';
import { CrmNoteSectionOrganism } from './ClientCardPage.crm-note.organism';
import {
  ClientProfileHeroOrganism,
  ContactSectionOrganism,
} from './ClientCardPage.parts.organism';
import { HistorySectionOrganism } from './ClientCardPage.history.organism';
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
  const router = useRouter();
  const { data: user, isLoading: userLoading } = useCurrentUserAccount();

  const currentPlan =
    user?.stylist_account?.pricing_plan ?? PricingPlanValue.FREE;
  const planConfig = PRICING_POLICY.utils.getPlanConfig(currentPlan);
  const hasCardAccess = PRICING_POLICY.utils.canViewHistory(planConfig);
  const showLocked =
    !userLoading && user !== undefined && !hasCardAccess && clientUserId !== '';

  const contact = useClientContactForStylist(clientUserId, hasCardAccess);
  const crmNote = useClientCrmNote(clientUserId, hasCardAccess);
  const visits = useClientVisits(clientUserId, hasCardAccess);
  const upsertNote = useUpsertClientCrmNote(clientUserId);
  const deleteNote = useDeleteClientCrmNote(clientUserId);
  const createManualVisit = useCreateManualVisit(clientUserId);
  const updateVisitNote = useUpdateVisitNote(clientUserId);
  const removePhoto = useRemoveVisitResultPhoto(clientUserId);
  const deleteManualVisit = useDeleteManualVisit(clientUserId);

  const title = contact.data?.client_name ?? t('title');
  useAppBarTitle(title);

  const trialAvailable = canStartTrial({
    trialStartedAt: user?.stylist_account?.trial_started_at,
    paymentStatus: user?.stylist_account?.payment_status,
  });
  const payHref = buildPlanPayDeepLink(PricingPlanValue.PRO, 'month');

  useEffect(() => {
    if (showLocked) {
      posthog.capture('upgrade_prompt_shown', {
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

  // DECISION (nie usuwaj tego komentarza):
  // Guard na `user === undefined`, NIE na `userLoading`. useCurrentUserAccount ma
  // enabled=hasSessionToken(): na SSR localStorage jest niedostępny → query disabled
  // → TQ v5 isLoading=false (fetchStatus 'idle') → serwer renderowałby PEŁNĄ kartę,
  // a klient (token w localStorage → enabled → isLoading=true) renderuje skeleton =
  // hydration mismatch. `user === undefined` jest zbieżne SSR↔client (dane nie przyszły
  // w obu) i eliminuje flakiness isLoading/isPending. Strona żyje za auth-guardem
  // AppLayout, więc user zawsze się rozwiąże (brak ryzyka wiecznego skeletonu).
  if (user === undefined || clientUserId === '') {
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

  if (showLocked) {
    return (
      <ClientCardLockedOrganism
        trialAvailable={trialAvailable}
        onCta={() => void router.push(payHref)}
      />
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
      {/* DECISION (nie usuwaj tego komentarza) — S126, order of the card:
          the ONE main action (add a visit) right under the intro, then what
          the stylist reads before the visit (her note), then the history.
          Contact is reference data: second column from 720px of own width,
          last on a phone. */}
      <PageColumnsMolecule
        main={
          <>
            <ManualVisitComposerMolecule
              isPending={createManualVisit.isPending}
              onCreate={payload => createManualVisit.mutateAsync(payload)}
            />
            <CrmNoteSectionOrganism
              initialNote={crmNote.data?.note}
              updatedAt={crmNote.data?.updatedAt}
              isLoading={crmNote.isLoading}
              isError={crmNote.isError}
              onRetry={() => void crmNote.refetch()}
              isRetrying={crmNote.isFetching}
              isSaving={upsertNote.isPending}
              isSaveError={upsertNote.isError}
              isDeleting={deleteNote.isPending}
              isDeleteError={deleteNote.isError}
              onSave={note => upsertNote.mutate(note)}
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
