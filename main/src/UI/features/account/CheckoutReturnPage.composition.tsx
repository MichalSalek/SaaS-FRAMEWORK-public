// UI/features/account/CheckoutReturnPage.composition.tsx
//
// The owned checkout-result endpoint verifies the active Stripe session and backend entitlement.
// Direct plan changes use same-tab operation proof together with the refreshed account entitlement.
// Unknown outcomes remain neutral and never trigger another checkout.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { CircleNotchIcon, HourglassIcon } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { type PricingPlan } from '@kernel/domain/pricing/pricing.config';
import { ACCOUNT_CONTRACTS } from '@kernel/domain/account/account.contracts';
import { contractEndpoint } from '../../../application/http/io';
import { readPurchaseChangeProof } from '../../../application/client-device-storage/purchase-change-proof';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useReportHeroVisibility } from '../../components/AppHero/useReportHeroVisibility';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import { captureOnboardingCompleted } from '../../../application/analytics/onboarding-events';
import {
  getFromClientStorage,
  setToClientStorage,
} from '../../../application/client-device-storage/clientStorage.possibilities.api';
import { checkoutCompletedKey } from '../../../application/client-device-storage/storage-keys.config';
import styles from './CheckoutReturnPage.module.css';
import { isCheckoutPlanConfirmed } from './checkout-return.helpers';
import { CheckoutSuccessOrganism } from './CheckoutSuccess.organism';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';

// Poll cadence while waiting for the Stripe webhook to write the plan.
const CHECKOUT_RESOLVE_POLL_MS = 1500;
const CHECKOUT_RESOLVE_MAX_POLLS = 8; // ~12s, then fail-open (never trap the user).

type RouterQuery = ReturnType<typeof useRouter>['query'];

function readQueryParam(query: RouterQuery, key: string): string | undefined {
  const raw = query[key];
  if (typeof raw === 'string') {
    return raw;
  }
  if (Array.isArray(raw) && typeof raw[0] === 'string') {
    return raw[0];
  }
  return undefined;
}

const getCheckoutResult = contractEndpoint(
  ACCOUNT_CONTRACTS.ACCOUNT_CHECKOUT_RESULT,
  { successFeedback: 'silent', errorFeedbackPolicy: 'background' }
);

function CheckoutReturnInner() {
  const t = useTranslations('account.checkout.return');
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    data: currentUser,
    isError,
    isFetching,
    refetch,
  } = useCurrentUserAccount();

  const sessionId = readQueryParam(router.query, 'sessionId') ?? '';
  const hasSession = router.isReady && sessionId !== '';
  const proofId = readQueryParam(router.query, 'proof') ?? '';
  const accountId = currentUser?.stylist_account?.account_id;
  const proof =
    currentUser?.id && accountId && proofId
      ? readPurchaseChangeProof(currentUser.id, accountId, proofId)
      : null;
  const hasChange =
    router.isReady &&
    readQueryParam(router.query, 'change') === 'completed' &&
    proof !== null;
  const hasConfirmation = hasSession || hasChange;
  const resultQuery = useQuery({
    queryKey: ['checkout-result', currentUser?.id, accountId, sessionId],
    queryFn: ({ signal }) => getCheckoutResult({ sessionId }, { signal }),
    enabled: hasSession && Boolean(currentUser?.id && accountId),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
  const resultTarget = hasSession
    ? resultQuery.data?.target
    : proof
      ? { planId: proof.plan, billingPeriod: proof.period }
      : null;
  const expectedPlan: PricingPlan | null = resultTarget?.planId ?? null;
  const refetchResult = resultQuery.refetch;
  const resultStatus = resultQuery.data?.status;
  const billingPeriod = resultTarget?.billingPeriod;
  const checkoutSource = readQueryParam(router.query, 'source');

  // On a confirmed arrival (sessionId present), nudge the account cache so the
  // webhook-written plan change surfaces on the next refetch. Once per session.
  const invalidated = useRef(false);
  useEffect(() => {
    if (hasConfirmation && !invalidated.current) {
      invalidated.current = true;
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.current,
      });
      // Plan limits changed → usage-vs-limit stats must re-derive too.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.usageStats,
      });
    }
  }, [hasConfirmation, queryClient]);

  // Poll the owned result and account mirror for a bounded time, then offer a manual retry.
  const entitlementResolved = isCheckoutPlanConfirmed(
    currentUser?.stylist_account,
    expectedPlan,
    { ...(billingPeriod ? { billingPeriod } : {}), acceptCanceling: hasChange }
  );
  const planResolved = hasSession
    ? !resultQuery.isFetching &&
      !resultQuery.isError &&
      resultQuery.data?.status === 'confirmed' &&
      isCheckoutPlanConfirmed(currentUser?.stylist_account, expectedPlan)
    : hasChange && entitlementResolved;
  const canResolve =
    (hasSession && Boolean(currentUser?.id && accountId)) || hasChange;
  const [polls, setPolls] = useState(0);
  useEffect(() => {
    if (
      !canResolve ||
      planResolved ||
      resultStatus === 'expired' ||
      polls >= CHECKOUT_RESOLVE_MAX_POLLS
    ) {
      return;
    }
    const id = window.setTimeout(() => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.current,
      });
      if (hasSession && currentUser?.id && accountId) {
        void refetchResult();
      }
      setPolls(prev => prev + 1);
    }, CHECKOUT_RESOLVE_POLL_MS);
    return () => window.clearTimeout(id);
  }, [
    canResolve,
    planResolved,
    polls,
    queryClient,
    hasSession,
    currentUser?.id,
    accountId,
    refetchResult,
    resultStatus,
  ]);

  const finalizingPlan =
    (hasSession && currentUser === undefined && !isError) ||
    (canResolve &&
      !planResolved &&
      resultQuery.data?.status !== 'expired' &&
      polls < CHECKOUT_RESOLVE_MAX_POLLS);

  // Funnel end for a PAID stylist (ANALYTICS_TRACKING_PLAN §3): the onboarding
  // page only sees `free_selected`; the paid path ends HERE, after Stripe's
  // redirect, once the webhook confirmed the plan. Latched per sessionId in
  // sessionStorage so a reload of this page does not double-count.
  useEffect(() => {
    if (!hasSession || !planResolved || checkoutSource !== 'onboarding') {
      return;
    }
    const latchKey = checkoutCompletedKey(sessionId);
    if (getFromClientStorage({ key: latchKey }) !== null) {
      return;
    }
    setToClientStorage({ key: latchKey, value: '1', sessionOnly: true });
    captureOnboardingCompleted('stylist', expectedPlan, billingPeriod);
  }, [
    hasSession,
    planResolved,
    checkoutSource,
    sessionId,
    expectedPlan,
    billingPeriod,
  ]);

  // The card with the h1 (pending/success) is the screen's local hero: it reports
  // its visibility to AppLayout (large-title mechanism) so the top bar does not
  // repeat the title. Enabled only in h1 branches; spinner branches report false
  // (the top bar title is visible, nothing to repeat).
  const heroRef = useRef<HTMLElement | null>(null);
  useReportHeroVisibility(heroRef, router.isReady && !finalizingPlan);

  /* ── Waiting: the router has not hydrated the query yet, or the webhook has
        not written the plan (holding her here keeps the mandatory-plan guard
        from bouncing a just-paid stylist to onboarding). One view for both, in
        the geometry of the result that replaces it: mark, one sentence, one
        button. ── */
  if (!router.isReady || (finalizingPlan && !isError)) {
    return (
      <div className={styles.viewport}>
        <div className={styles.card} role='status' aria-busy='true'>
          <span className={styles.mark} aria-hidden='true'>
            <CircleNotchIcon size={32} className={styles.spinner} />
          </span>
          <p className={styles.title}>{t('checking')}</p>
          <div className={styles.actions} aria-hidden='true'>
            <SkeletonAtom variant='rect' width='100%' height={48} />
          </div>
        </div>
      </div>
    );
  }

  /* ── Success — payment CONFIRMED: the webhook actually wrote the plan
        (planResolved). One sentence, one action. ── */
  if (isError) {
    return (
      <ErrorStateMolecule
        message={t('readError')}
        retryLabel={t('ctaRetry')}
        isRetrying={isFetching}
        onRetry={() => void refetch()}
      />
    );
  }
  if (hasConfirmation && planResolved && expectedPlan !== null) {
    const successSessionId = hasSession ? sessionId : proofId;
    return (
      <CheckoutSuccessOrganism
        plan={expectedPlan}
        {...(currentUser?.id && accountId
          ? {
              resume: {
                userId: currentUser.id,
                accountId,
                sessionId: successSessionId,
              },
            }
          : {})}
      />
    );
  }

  /* ── Neutral — a direct hit (no sessionId) OR the poll window elapsed without
        the webhook confirming (slow webhook, or an abandoned redirect method like
        BLIK/P24 that returns here regardless of outcome). NEVER a green success
        for a payment we can't confirm — pendingBody already tells the buyer the
        plan updates automatically if it did go through, so the fail-open path is
        honest instead of claiming an upgrade that may not have happened. ── */
  return (
    <div className={styles.viewport}>
      <section ref={heroRef} className={styles.card}>
        <span className={styles.mark} aria-hidden='true'>
          <HourglassIcon size={32} weight='duotone' />
        </span>
        <h1 className={styles.title}>{t('pendingTitle')}</h1>
        <p className={styles.body}>{t('pendingBody')}</p>
        <div className={styles.actions}>
          {/* The polling window is over and the checkout target is known:
              re-checking ON THIS page is the main action. The mandatory-plan
              guard exempts only this route, so an onboarding stylist whose
              webhook is late would land back on plan choice after „Przejdź do
              aplikacji". Without a known target (hand-opened URL) the one
              action is: to the app. */}
          {canResolve && (
            <ButtonAtom
              variant='primary'
              size='lg'
              className={styles.actionBtn}
              onClick={() => {
                setPolls(0);
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.account.current,
                });
                if (hasSession) {
                  void refetchResult();
                }
              }}>
              {t('ctaRetry')}
            </ButtonAtom>
          )}
          <LinkButtonAtom
            href={ROUTES_FRONT.APP}
            variant={canResolve ? 'outlined' : 'primary'}
            size='lg'
            direction={canResolve ? undefined : 'forward'}
            className={styles.actionBtn}>
            {t('ctaApp')}
          </LinkButtonAtom>
        </div>
      </section>
    </div>
  );
}

export function CheckoutReturnPageComposition() {
  const t = useTranslations('account.checkout.return');
  return (
    <AppLayoutComposition title={t('title')}>
      <CheckoutReturnInner />
    </AppLayoutComposition>
  );
}
