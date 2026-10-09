// UI/features/account/CheckoutReturnPage.composition.tsx
//
// SPE (W2): the post-payment landing. Stripe redirects here (the Checkout
// Session's return_url, built backend-side as
// `/app/checkout/return?sessionId={CHECKOUT_SESSION_ID}`) after the embedded
// PaymentElement confirm() succeeds, OR after a redirect method (BLIK/P24).
//
// DECISION (nie usuwaj tego komentarza):
// MVP trusts the Stripe webhook as the source of truth for the plan upgrade —
// there is NO front-side checkout-status endpoint (would duplicate the webhook
// that already flips payment_status server-side). On arrival we invalidate the
// account query so the eventual webhook write surfaces on the next refetch.
// "Confirmed" means ONE thing: the account now carries the plan this checkout
// was minted for (`plan` in the return_url, stamped backend-side next to Stripe's
// {CHECKOUT_SESSION_ID} placeholder). The previous predicate ("account may be
// active") was true from the first render for every stylist already on Free, so
// an abandoned BLIK/P24 redirect showed a green success. A missing sessionId or
// an unknown `plan` (URL opened by hand, query stripped by an in-app browser)
// degrades to the neutral "back to app" card — never green, never an error, the
// payment may simply not have happened.
//
// Stack: TQ v5 + next/router + CSS Modules + Phosphor.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import {
  CheckCircleIcon,
  CircleNotchIcon,
  HourglassIcon,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  getPlanDisplayName,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { isPricingPlanNarrower } from '@kernel/models/type_narrowing';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
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

function readBillingPeriod(raw: string | undefined): BillingPeriod | undefined {
  return raw === 'month' || raw === 'year' ? raw : undefined;
}

function CheckoutReturnInner() {
  const t = useTranslations('account.checkout.return');
  const router = useRouter();
  const queryClient = useQueryClient();

  const sessionId = readQueryParam(router.query, 'sessionId') ?? '';
  const hasSession = router.isReady && sessionId !== '';
  // Target of THIS checkout (stamped backend-side into return_url). Unknown or
  // tampered value → null → unresolvable → neutral card (no polling, no green).
  const planParam = readQueryParam(router.query, 'plan');
  const expectedPlan: PricingPlan | null = isPricingPlanNarrower(planParam)
    ? planParam
    : null;
  const billingPeriod = readBillingPeriod(
    readQueryParam(router.query, 'period')
  );
  const checkoutSource = readQueryParam(router.query, 'source');

  // On a confirmed arrival (sessionId present), nudge the account cache so the
  // webhook-written plan change surfaces on the next refetch. Once per session.
  const invalidated = useRef(false);
  useEffect(() => {
    if (hasSession && !invalidated.current) {
      invalidated.current = true;
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.current,
      });
      // Plan limits changed → usage-vs-limit stats must re-derive too.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.usageStats,
      });
    }
  }, [hasSession, queryClient]);

  // DECISION (nie usuwaj tego komentarza):
  // Poll the account until the webhook has WRITTEN the plan this checkout was
  // minted for, then gate the "go to app" CTA on it. Without this a just-paid
  // stylist who clicks through BEFORE the webhook lands hits the mandatory-plan
  // guard (useOnboardingPlanGuard) as still-unresolved → bounced to onboarding
  // ("I paid and got kicked to onboarding"). The optimistic plan_selected_at
  // marker that used to paper over this was removed backend-side (2026-07-10), so
  // the return page now owns the wait. Fail-open after MAX_POLLS: rather than
  // trapping the user we drop to the NEUTRAL card (not a green success) — a slow
  // webhook or an abandoned redirect method (BLIK/P24, which returns here whether
  // or not the buyer finished) must never be reported as a confirmed upgrade.
  // Compared on pricing_plan alone: the same webhook writes it for trials, and
  // the checkout UI never mints a session for the plan the account already holds
  // (selectPlan rejects planId === currentPlan), so "already on target" cannot
  // pre-satisfy the check.
  const { data: currentUser } = useCurrentUserAccount();
  const planResolved =
    expectedPlan !== null &&
    currentUser?.stylist_account?.pricing_plan === expectedPlan;
  const canResolve = hasSession && expectedPlan !== null;
  const [polls, setPolls] = useState(0);
  useEffect(() => {
    if (!canResolve || planResolved || polls >= CHECKOUT_RESOLVE_MAX_POLLS) {
      return;
    }
    const id = window.setTimeout(() => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.current,
      });
      setPolls(prev => prev + 1);
    }, CHECKOUT_RESOLVE_POLL_MS);
    return () => window.clearTimeout(id);
  }, [canResolve, planResolved, polls, queryClient]);

  const finalizingPlan =
    canResolve && !planResolved && polls < CHECKOUT_RESOLVE_MAX_POLLS;

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

  // Karta z h1 (pending/success) = lokalny hero ekranu — raportuje widoczność
  // do AppLayout (SSOT mechanizmu large-title), by top-bar nie dublował tytułu.
  // `enabled` tylko w gałęziach z h1; spinner-gałęzie raportują false (tytuł
  // w top-barze widoczny — nie ma czego dublować).
  const heroRef = useRef<HTMLElement | null>(null);
  useReportHeroVisibility(heroRef, router.isReady && !finalizingPlan);

  /* ── Waiting: the router has not hydrated the query yet, or the webhook has
        not written the plan (holding her here keeps the mandatory-plan guard
        from bouncing a just-paid stylist to onboarding). One view for both, in
        the geometry of the result that replaces it: mark, one sentence, one
        button. ── */
  if (!router.isReady || finalizingPlan) {
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
  if (hasSession && planResolved && expectedPlan !== null) {
    return (
      <div className={styles.viewport}>
        <section ref={heroRef} className={styles.card} role='status'>
          <span
            className={`${styles.mark} ${styles.markSuccess}`}
            aria-hidden='true'>
            <CheckCircleIcon size={32} weight='fill' />
          </span>
          <h1 className={styles.title}>
            {t('successTitle', { plan: getPlanDisplayName(expectedPlan) })}
          </h1>
          <div className={styles.actions}>
            <LinkButtonAtom
              href={ROUTES_FRONT.APP}
              variant='primary'
              size='lg'
              direction='forward'
              className={styles.actionBtn}>
              {t('ctaApp')}
            </LinkButtonAtom>
          </div>
        </section>
      </div>
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
          {/* Okno pollingu minęło, a cel checkoutu jest znany: ponowne
              sprawdzenie NA TEJ stronie jest wtedy główną akcją. Guard
              obowiązkowego planu zwalnia tylko tę trasę, więc stylistka
              z onboardingu, której webhook się spóźnia, po „Przejdź do
              aplikacji" wróciłaby na wybór planu. Bez znanego celu (wejście
              z ręki) zostaje jedna akcja: do aplikacji. */}
          {canResolve && (
            <ButtonAtom
              variant='primary'
              size='lg'
              className={styles.actionBtn}
              onClick={() => setPolls(0)}>
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
