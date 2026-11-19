import {
  BillingDetailsSectionOrganism,
  PayLoadingSkeletonOrganism,
  PayHeroOrganism,
  PayPriceNoticeOrganism,
  PayChangeReturnNoticeOrganism,
} from './AccountPayPage.extra.organism';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { useIsClient } from '../../shared/hooks/useSessionRole';
// Shared in-place role-switch mutation (also powers dashboard RoleSwitcher) —
// POST /user/switch-role, refetches the BA session so `useIsClient` flips.
import { useSwitchRole } from '../shared/hooks/useSwitchRole';
import { usePricingFunnelState } from '../../shared/hooks/usePricingFunnelState';
import { usePricingPlans } from '../shared/pricing/hooks/usePricingPlans';
import { useAccountPayActions } from './hooks/useAccountPayActions';
import { usePlanChangePreview } from './hooks/usePlanChangePreview';
import { usageStatsQueryOptions } from '../shared/account/hooks/useUsageStats';
import { PlansHeaderOrganism } from './AccountPayPage.hero.organism';
import { freePlanSummaryParams } from '../../../application/pricing/plan-features.catalog';
import {
  PlanCardOrganism,
  PayRoleSwitchOrganism,
  PayFaqOrganism,
  buildPlanTx,
  buildPayFaq,
} from './AccountPayPage.parts.organism';
import { toDowngradeWarningStats } from './components/downgradeWarning.helpers';
import { AccountPayDialogsOrganism } from './components/AccountPayDialogs.organism';
import type { BillingCycle } from '../../components/BillingToggle/BillingToggle.molecule';
import {
  openContactMail,
  payBillingHintKey,
  resolvePlanStatusCopy,
  resolveRecommendedPlanId,
  toBillingPeriod,
} from './AccountPayPage.helpers';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import styles from './AccountPayPage.module.css';
import { purchaseResumeIdentityOption } from '../../../application/client-device-storage/purchase-resume';

function AccountPayPageInner() {
  const t = useTranslations('account.pay');
  const router = useRouter();
  const lang = useCurrentLang();
  useAppBarTitle(t('title'));

  const {
    data: user,
    isLoading: userLoading,
    isError: userError,
    isFetching: userFetching,
    refetch: refetchUser,
  } = useCurrentUserAccount();
  const {
    data: plans,
    isLoading: plansLoading,
    isError: plansError,
    isFetching: plansFetching,
    refetch: refetchPlans,
    pricesUnavailable,
    currency,
    country,
    internationalBillingEnabled,
    isCurrencyLocked,
    billingProfile,
  } = usePricingPlans();

  // Active session role (mode). A dual-role user (has stylist_account) can be in
  // CLIENT mode on this page — every billing action would then 403 server-side.
  const isClientMode = useIsClient();
  const switchRole = useSwitchRole();

  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const cycleChosen = useRef(false);
  const currentCycle = user?.stylist_account?.billing?.billingPeriod ?? null;
  useEffect(() => {
    if (!cycleChosen.current && currentCycle !== null) {
      setBillingCycle(currentCycle);
    }
  }, [currentCycle]);

  const currentPlan: PricingPlan =
    user?.stylist_account?.pricing_plan ?? PricingPlanValue.FREE;

  // Real usage counts for the downgrade-warning loss copy (gallery photos +
  // paired clients that a downgrade would cap/drop). Gated to PAID plans: only a
  // paying stylist can trigger a downgrade, and ~96% of accounts are FREE, so
  // fetching usage-stats for them would be a wasted request. Cheap + cached 60s;
  // ready by the time the (interaction-gated) downgrade dialog opens.
  const { data: usage } = useQuery({
    ...usageStatsQueryOptions,
    enabled: currentPlan !== PricingPlanValue.FREE,
  });

  // Plan-change funnel (FREE→paid checkout, paid→paid quick change + SCA,
  // portal redirect, downgrade gate) lives in useAccountPayActions — keeps this
  // composition a thin renderer.
  //
  // DECISION: the trial is not started from a standalone banner on this page. A FREE/trial-eligible
  // stylist upgrades through the plan cards → embedded checkout dialog (PlanCheckoutPanel), which
  // shows the trial reassurance for trial-eligible paid plans (kernel canStartTrial SSOT, evaluated
  // INSIDE the panel). One funnel (card captured, charged after the trial) instead of two competing
  // CTAs. startTrial_IO / useStartTrial are superseded by checkoutSession_IO.
  const actions = useAccountPayActions({
    currentPlan,
    billingPeriod: toBillingPeriod(billingCycle),
    currentBillingPeriod:
      currentCycle === null ? null : toBillingPeriod(currentCycle),
    ...purchaseResumeIdentityOption(user),
  });
  const preview = usePlanChangePreview(
    actions.upgradeTarget ?? actions.downgradeTarget,
    toBillingPeriod(billingCycle)
  );

  // P1: pricing funnel carry-over. A visitor who picked a plan on /pricing lands
  // here with `?planId=&billingPeriod=` (or the sessionStorage fallback); read it
  // ONCE and pre-select, so she doesn't have to choose the plan a SECOND time.
  const { getPricingFunnel, clearPricingFunnel } = usePricingFunnelState();
  // selectPlan changes identity per render (fresh closure) — capture it in a ref
  // so the one-shot effect can call it without listing it as a dependency (which
  // would defeat the one-shot guard). The ref always holds the latest closure.
  const selectPlanRef = useRef(actions.selectPlan);
  selectPlanRef.current = actions.selectPlan;

  // DECISION: mount-gate. The account is auth-gated (token in localStorage) and SSR does not know
  // the session, so the query is disabled on the server (isLoading=false, plans=undefined) while the
  // first client render has a token (isLoading=true or an error branch): "server HTML didn't match
  // client". SSR and the first CSR render the same skeleton; error/content only after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // DECISION: billing and plans are a STYLIST surface (only a stylist has a subscription to buy or
  // manage). A pure client has nothing here and got a blind 403 UNAUTHORIZED on upgrade (checkout is
  // STYLIST_SPECIFIC RBAC), so it is bounced to /app and the "Płatności" rail item is hidden for it
  // (AccountWebLayout showBilling). Dual-role does NOT lose access: it HAS a stylist_account;
  // client-context checkout is gated by the server on the ACTIVE role, not by this page. A dual-role
  // user in client mode gets a switch affordance (isClientMode branch + PayRoleSwitchOrganism)
  // instead of a doomed mint and a sessionError/retry loop. The guard runs after mount + user-loaded.
  const hasStylistAccount =
    user?.stylist_account !== null && user?.stylist_account !== undefined;
  useEffect(() => {
    if (mounted && !userLoading && !userError && user && !hasStylistAccount) {
      void router.replace(ROUTES_FRONT.APP);
    }
  }, [mounted, userLoading, userError, user, hasStylistAccount, router]);

  // P1: one-shot funnel consumption — fire AFTER the account loaded (so
  // `currentPlan` is authoritative, never the FREE default during fetch) and
  // AFTER router.isReady (so the deep-link query is populated and wins over
  // storage per usePricingFunnelState precedence). Only a FREE stylist auto-opens
  // a paid checkout; paid→paid is left to the manual quick-change cards (no
  // surprise charge), and a funnel pointing at the current plan is a no-op.
  const funnelConsumedRef = useRef(false);
  const [checkoutPromo, setCheckoutPromo] = useState<string | undefined>();
  const [checkoutSource, setCheckoutSource] = useState<
    'onboarding' | 'account-pay'
  >('account-pay');
  useEffect(() => {
    if (
      funnelConsumedRef.current ||
      !mounted ||
      !router.isReady ||
      userLoading ||
      userError ||
      user === undefined ||
      // Client mode → role-switch prompt renders (below), not checkout. Don't
      // consume the funnel yet: it survives the switch and auto-opens once the
      // effect re-runs in stylist mode (isClientMode flip).
      isClientMode
    ) {
      return;
    }
    funnelConsumedRef.current = true;
    const funnel = getPricingFunnel();
    setCheckoutPromo(funnel?.promo);
    setCheckoutSource(funnel?.source ?? 'account-pay');
    // Always drop the stored intent once we've looked at it — a single funnel
    // run, never a sticky preference that re-fires on the next visit.
    clearPricingFunnel();
    // Gate to FREE→paid only: a paying stylist never auto-charges from a funnel
    // (paid→paid / downgrade stays on the manual quick-change cards), and FREE is
    // not a checkout. With currentPlan === FREE and funnel.planId ≠ FREE the
    // "different plan" requirement holds by construction (an explicit
    // funnel.planId !== currentPlan check would be dead code here — TS proves it).
    if (
      funnel === null ||
      funnel.planId === PricingPlanValue.FREE ||
      currentPlan !== PricingPlanValue.FREE
    ) {
      return;
    }
    setBillingCycle(funnel.billingPeriod === 'year' ? 'yearly' : 'monthly');
    // Opens PlanCheckoutDialog for the FREE→paid path (selectPlan routes FREE to
    // the embedded checkout). Batched with setBillingCycle, so the dialog renders
    // with the funnel's period.
    selectPlanRef.current(funnel.planId);
  }, [
    mounted,
    router.isReady,
    userLoading,
    userError,
    user,
    currentPlan,
    isClientMode,
    getPricingFunnel,
    clearPricingFunnel,
  ]);

  // Real loss numbers for the downgrade warning; null (generic copy) while the
  // usage query settles, fails or is disabled (FREE user, never downgrades).

  const handleSwitchToStylist = () => {
    switchRole.mutate({ account_type: AccountTypeValue.STYLIST });
  };

  /* ── Loading skeleton (mount-gate + loading-guard): the boxes of the final
     page (intro, plan-list header with the period switch, plan cards), so
     nothing jumps when the account and the price list arrive. ── */

  /* ── Mount gate (hydration): SSR and the first client render show the same
     skeleton before error/content (which depend on the client-only session) appear ── */
  if (!mounted) {
    return <PayLoadingSkeletonOrganism />;
  }

  // Full error ONLY without data: a failed background refresh (window focus,
  // invalidation after a plan change) leaves the last account and price state
  // cached, yet TanStack still sets `isError`. Then the normal layout stays.
  if ((userError && !user) || (plansError && !plans)) {
    return (
      <div className={styles.page}>
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={t('retry')}
          isRetrying={userFetching || plansFetching}
          onRetry={() => {
            void refetchUser();
            void refetchPlans();
          }}
        />
      </div>
    );
  }

  /* ── Loading, or a pure-client redirect in flight (effect wyżej) — trzymaj
     skeleton, nie błyskaj stylist-billing UI zanim router.replace(/app)
     dobiegnie. ── */
  if (userLoading || plansLoading || !plans || !hasStylistAccount) {
    return <PayLoadingSkeletonOrganism />;
  }

  /* ── Dual-role in CLIENT mode: billing is a STYLIST surface (checkout 403s by active role);
     hasStylistAccount is already true here (pure clients are redirected). Pre-empt the doomed
     mint + retry dead-loop. ── */
  if (isClientMode) {
    return (
      <PayRoleSwitchOrganism
        title={t('switchRolePrompt.title')}
        body={t('switchRolePrompt.body')}
        ctaLabel={t('switchRolePrompt.cta')}
        isSwitching={switchRole.isPending}
        onSwitch={handleSwitchToStylist}
      />
    );
  }

  const currentIndex = plans.findIndex(p => p.id === currentPlan);

  // What the Stripe mirror fields say (next payment, trial end, scheduled
  // cancellation, failed payment), not a blanket "subscription active".
  const status = resolvePlanStatusCopy(user?.stylist_account ?? null, lang);
  const heroTitle =
    currentIndex >= 0
      ? t('heroTitle', { plan: plans[currentIndex]?.name ?? '' })
      : t('title');
  // ONE filled action on the screen: the recommended plan's button, or (top
  // tier, failed payment) the billing button. Never both.
  const recommendedPlanId = resolveRecommendedPlanId(
    plans,
    currentIndex,
    status.kind
  );

  return (
    <div className={styles.page}>
      <PayChangeReturnNoticeOrganism href={actions.changeReturnHref} />
      <PayHeroOrganism
        title={heroTitle}
        meta={
          status.keys.heroMeta !== null
            ? t(status.keys.heroMeta, freePlanSummaryParams())
            : null
        }
        pastDue={status.kind === 'pastDue'}
      />

      <BillingDetailsSectionOrganism
        profile={billingProfile.data}
        isError={billingProfile.isError}
        onOpen={actions.openBillingPortal}
        isOpening={actions.openingPortal}
      />

      <section className={styles.plansSection}>
        <PlansHeaderOrganism
          title={t('plansTitle')}
          cycle={billingCycle}
          onCycleChange={cycle => {
            cycleChosen.current = true;
            setBillingCycle(cycle);
          }}
          monthlyLabel={t('billingMonthly')}
          yearlyLabel={t('billingYearly')}
          periodLabel={t('billingPeriodLabel')}
          hint={t(payBillingHintKey(checkoutPromo, billingCycle))}
        />

        <PayPriceNoticeOrganism unavailable={pricesUnavailable} />

        <div className={styles.plansList}>
          {plans.map((plan, index) => (
            <PlanCardOrganism
              key={plan.id}
              currency={currency ?? 'usd'}
              plan={plan}
              isCurrent={plan.id === currentPlan}
              billingChangeLabel={
                plan.id === currentPlan &&
                currentCycle !== null &&
                currentCycle !== billingCycle
                  ? t(
                      billingCycle === 'monthly'
                        ? 'changeToMonthly'
                        : 'changeToYearly'
                    )
                  : undefined
              }
              isDowngrade={index < currentIndex}
              isRecommended={plan.id === recommendedPlanId}
              billingCycle={billingCycle}
              isPending={actions.pendingPlan === plan.id}
              disableActions={
                actions.busy ||
                pricesUnavailable ||
                (plan.id !== PricingPlanValue.FREE &&
                  !isCurrencyLocked &&
                  country !== 'PL' &&
                  !internationalBillingEnabled)
              }
              hasError={actions.failedPlan === plan.id}
              onManage={actions.selectPlan}
              onContactSales={openContactMail}
              tx={buildPlanTx(t)}
            />
          ))}
        </div>
        <PayPriceNoticeOrganism country={country} />
      </section>

      <PayFaqOrganism title={t('faq.title')} entries={buildPayFaq(t)} />

      <AccountPayDialogsOrganism
        actions={actions}
        currentPlan={currentPlan}
        preview={preview}
        stats={toDowngradeWarningStats(usage)}
        plans={plans}
        billingPeriod={toBillingPeriod(billingCycle)}
        promo={checkoutPromo}
        source={checkoutSource}
      />
    </div>
  );
}

export function AccountPayPageComposition() {
  const t = useTranslations('account.pay');
  return (
    <AppLayoutComposition title={t('title')}>
      <AccountPayPageInner />
    </AppLayoutComposition>
  );
}
