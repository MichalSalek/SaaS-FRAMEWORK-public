// UI/features/account/ActivateRolePage.tsx
// Activation of a second account (client OR stylist).
// Two routes -> one component, role-distinct via the `roleValue` prop.
// Stack: TanStack Query v5 + CSS Modules.
//
// One decision, one screen: what the account gives (white box), how it works
// (facts on paper), then consent and the action together in the bottom bar.

import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { getAccountState_IO } from '../../../domain/user/userOnboardingIO.possibilities.api';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import { pushNewSnackbar } from '../../../application/app-snackbar/appSnackbar.possibilities.api';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import {
  ActivateConsentOrganism,
  BenefitsCardOrganism,
  FactsListOrganism,
} from './ActivateRolePage.parts.organism';
import { useActivateClientRole } from './hooks/useActivateRole';
import styles from './ActivateRolePage.module.css';

/* ─── Types ─── */

export interface ActivateRolePageProps {
  // Named `roleValue` (not `role`) so call sites don't trip jsx-a11y/aria-role —
  // this is a domain prop (which account role to activate), not an ARIA role.
  roleValue: 'client' | 'stylist';
}

/* ─── Fetcher ─── */

const accountStateQueryOptions = queryOptions({
  queryKey: queryKeys.account.state,
  queryFn: ({ signal }) => getAccountState_IO({}, { signal }),
  staleTime: 30_000,
  retry: 1,
});

const CLIENT_BENEFIT_KEYS = [
  'benefitClientFree',
  'benefitClientBrowse',
  'benefitClientInspire',
  'benefitClientPair',
] as const;

const STYLIST_BENEFIT_KEYS = [
  'benefitStylistGallery',
  'benefitStylistProfile',
  'benefitStylistClients',
  'benefitStylistFree',
] as const;

/* Each fact is stated once on the screen: what used to be repeated in the
 * hero chips, the steps card and the reassurance aside is this one list. */
const CLIENT_FACT_KEYS = [
  'step1',
  'step2Client',
  'reassuranceSafe',
  'reassuranceData',
] as const;

const STYLIST_FACT_KEYS = [
  'step2Stylist',
  'step3Stylist',
  'step1',
  'reassuranceSafe',
  'reassuranceData',
] as const;

/* ─── Component ─── */

export function ActivateRolePageComposition({
  roleValue: role,
}: ActivateRolePageProps) {
  const t = useTranslations('account.activate');
  const router = useRouter();
  const queryClient = useQueryClient();
  const isClientRole = role === 'client';

  /* Account state — drives the "already has role -> redirect" guard */
  const accountStateQuery = useQuery(accountStateQueryOptions);
  const accountState = accountStateQuery.data;
  const hasClientAccount = accountState?.has_client_account ?? false;
  const hasStylistAccount = accountState?.has_stylist_account ?? false;
  const alreadyHasRole = isClientRole ? hasClientAccount : hasStylistAccount;

  useEffect(() => {
    if (!accountState) {
      return;
    }
    if (alreadyHasRole) {
      void router.replace(ROUTES_FRONT.APP);
    }
  }, [accountState, alreadyHasRole, router]);

  const activateClientMutation = useActivateClientRole();

  /* Terms gate (both roles — activation is the legal touchpoint).
   *
   * DECISION (nie usuwaj tego komentarza) — owner 2026-10-08:
   * zgoda stoi W BELCE, tuż nad przyciskiem, a przycisk jest zawsze aktywny.
   * Wcześniej checkbox leżał na samym dole strony, a przyklejony przycisk
   * wyglądał na gotowy od pierwszego ekranu: stuknięcie pokazywało błąd poza
   * widokiem. Druga dopuszczona droga (przewinięcie do zgody po stuknięciu)
   * zostawiała decyzję rozbitą na dwa miejsca. Zgoda i akcja to jedna
   * decyzja, więc są w jednym miejscu, a brak zgody tłumaczy się obok. */
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTermsError, setShowTermsError] = useState(false);
  const [shake, setShake] = useState(false);
  const termsErrorId = useId();

  const ensureTerms = () => {
    if (!termsAccepted) {
      setShowTermsError(true);
      setShake(true);
      return false;
    }
    setShowTermsError(false);
    return true;
  };

  const handleActivateClient = () => {
    if (!ensureTerms()) {
      return;
    }
    activateClientMutation.mutate(undefined, {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.account.state,
        });
        pushNewSnackbar(t('activateSuccessMsg'), 'success');
        void router.push(ROUTES_FRONT.APP);
      },
    });
  };

  const handleGoToStylistOnboarding = () => {
    if (!ensureTerms()) {
      return;
    }
    // DECISION (nie usuwaj tego komentarza):
    // Przekazujemy ?role=stylist do onboardingu — user WŁAŚNIE zadeklarował
    // intencję "stylistka" na tej stronie. Onboarding czyta query (readPrefilledRole,
    // OnboardingPage) i pre-zaznacza kartę roli na kroku ROLE zamiast wymuszać
    // ponowny wybór (klientka aktywująca stylistkę nie musi drugi raz wybierać
    // roli ani widzieć opcji "Jestem klientką", którą już jest). Prefill jest
    // miękki (walidowany, !isDirty-guarded) — user nadal może zmienić. Ten sam
    // wzorzec: LoginPage / DashboardPage forwardują ?role identycznie.
    void router.push(`${ROUTES_FRONT.ONBOARDING}?role=${role}`);
  };

  const isActivating = activateClientMutation.isPending;
  const hasActivationError = activateClientMutation.isError;

  const ctaLabel = isClientRole
    ? isActivating
      ? t('ctaActivatingClient')
      : hasActivationError
        ? t('ctaRetry')
        : t('ctaClient')
    : t('ctaStylist');

  const title = isClientRole ? t('clientTitle') : t('stylistTitle');

  /* Without the account state the redirect guard cannot run, so the screen
   * says so instead of offering an activation that may already be done. */
  if (accountStateQuery.isError) {
    return (
      <AppLayoutComposition title={title} hideBottomNav>
        <div className={styles.page}>
          <ErrorStateMolecule
            message={t('loadError')}
            retryLabel={t('ctaRetry')}
            onRetry={() => void accountStateQuery.refetch()}
            isRetrying={accountStateQuery.isFetching}
          />
        </div>
      </AppLayoutComposition>
    );
  }

  return (
    <AppLayoutComposition title={title} hideBottomNav>
      <div className={styles.page}>
        <AppHeroOrganism
          title={isClientRole ? t('clientHeadline') : t('stylistHeadline')}
          subtitle={isClientRole ? t('clientSubtitle') : t('stylistSubtitle')}
        />

        <PageColumnsMolecule
          main={
            <BenefitsCardOrganism
              title={t('benefitsTitle')}
              benefits={(isClientRole
                ? CLIENT_BENEFIT_KEYS
                : STYLIST_BENEFIT_KEYS
              ).map(key => t(key))}
            />
          }
          aside={
            <FactsListOrganism
              title={t('howEyebrow')}
              facts={(isClientRole ? CLIENT_FACT_KEYS : STYLIST_FACT_KEYS).map(
                key => t(key)
              )}
            />
          }
        />

        <div className={styles.ctaSection}>
          <ActivateConsentOrganism
            termsAccepted={termsAccepted}
            onChange={next => {
              setTermsAccepted(next);
              if (next) {
                setShowTermsError(false);
              }
            }}
            showError={showTermsError}
            errorId={termsErrorId}
            t={t}
          />
          {hasActivationError && (
            <p className={styles.ctaError} role='alert'>
              {t('activateError')}
            </p>
          )}
          <ButtonAtom
            variant='primary'
            size='lg'
            {...(isClientRole ? {} : { direction: 'forward' as const })}
            className={`${styles.ctaButton} haptic-press`}
            onClick={
              isClientRole ? handleActivateClient : handleGoToStylistOnboarding
            }
            disabled={isActivating}
            aria-busy={isActivating}
            shake={shake}
            onShakeEnd={() => setShake(false)}>
            {ctaLabel}
          </ButtonAtom>
        </div>
      </div>
    </AppLayoutComposition>
  );
}
