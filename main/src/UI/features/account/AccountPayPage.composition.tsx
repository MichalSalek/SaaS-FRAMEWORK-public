import { useEffect, useId, useRef, useState } from 'react';
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
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { useIsClient } from '../../shared/hooks/useSessionRole';
// Shared in-place role-switch mutation (also powers dashboard RoleSwitcher) —
// POST /user/switch-role, refetches the BA session so `useIsClient` flips.
import { useSwitchRole } from '../shared/hooks/useSwitchRole';
import { usePricingFunnelState } from '../../shared/hooks/usePricingFunnelState';
import { usePricingPlans } from '../shared/pricing/hooks/usePricingPlans';
import { useAccountPayActions } from './hooks/useAccountPayActions';
import { usageStatsQueryOptions } from '../shared/account/hooks/useUsageStats';
import {
  BillingCardOrganism,
  PlansHeaderMolecule,
} from './AccountPayPage.hero.organism';
import {
  PlanCardOrganism,
  PayRoleSwitchOrganism,
  PayFaqOrganism,
  buildPlanTx,
  buildPayFaq,
  type PlanTranslations,
} from './AccountPayPage.parts.organism';
import {
  DowngradeWarningDialogOrganism,
  type DowngradeWarningStats,
} from './components/DowngradeWarningDialog.organism';
import { PlanCheckoutDialogOrganism } from './components/PlanCheckoutDialog.organism';
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
  } = usePricingPlans();
  const checkoutDialogTitleId = useId();

  // Active session role (mode). A dual-role user (has stylist_account) can be in
  // CLIENT mode on this page — every billing action would then 403 server-side.
  const isClientMode = useIsClient();
  const switchRole = useSwitchRole();

  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');

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
  // DECISION (nie usuwaj tego komentarza):
  // Trial is no longer started from a standalone banner on this page (W5). A
  // FREE/trial-eligible stylist upgrades through the plan cards → embedded
  // checkout dialog (PlanCheckoutPanel), which shows the trial reassurance note
  // for trial-eligible paid plans (kernel canStartTrial SSOT, evaluated INSIDE
  // the panel). One funnel — card captured, charged after the trial — instead
  // of two competing CTAs (banner + cards). startTrial_IO / useStartTrial are
  // superseded by checkoutSession_IO (the panel's mutation).
  const actions = useAccountPayActions({
    currentPlan,
    billingPeriod: toBillingPeriod(billingCycle),
  });

  // P1: pricing funnel carry-over. A visitor who picked a plan on /pricing lands
  // here with `?planId=&billingPeriod=` (or the sessionStorage fallback); read it
  // ONCE and pre-select, so she doesn't have to choose the plan a SECOND time.
  const { getPricingFunnel, clearPricingFunnel } = usePricingFunnelState();
  // selectPlan changes identity per render (fresh closure) — capture it in a ref
  // so the one-shot effect can call it without listing it as a dependency (which
  // would defeat the one-shot guard). The ref always holds the latest closure.
  const selectPlanRef = useRef(actions.selectPlan);
  selectPlanRef.current = actions.selectPlan;

  // DECISION (nie usuwaj — hydration fix): konto auth-gated (token w localStorage),
  // SSR nie zna sesji => query disabled (isLoading=false, plans=undefined). Pierwszy
  // client-render ma token => isLoading=true LUB (po fetch-fail) error-branch, podczas
  // gdy SSR pokazał skeleton => "server HTML didn't match client". Mount-gate: SSR i
  // first-CSR renderują identyczny skeleton; error/treść dopiero po zamontowaniu.
  // Wzorzec z siostrzanej AccountPage (S18).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // DECISION (nie usuwaj tego komentarza):
  // Billing/plany = powierzchnia STYLISTKI (tylko stylistka ma subskrypcję do
  // kupienia/zarządzania). Pure-client (brak stylist_account) nie ma tu czego
  // szukać — na próbie upgrade i tak dostawał ślepy 403 UNAUTHORIZED (checkout
  // = STYLIST_SPECIFIC RBAC). Odbijamy do /app; pozycja „Płatności" w rail-nav
  // jest dla niego ukryta (AccountWebLayout showBilling). Dual-role NIE traci
  // dostępu — MA stylist_account (widzi stronę); client-context checkout gatuje
  // serwer po AKTYWNEJ roli, nie ta strona. Dual-role w trybie klientki dostaje
  // afordancję przełączenia (isClientMode branch + PayRoleSwitchOrganism) zamiast
  // skazanego mintu i pętli sessionError/retry. Guard po mount + user-loaded.
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

  const isLoading = userLoading || plansLoading;

  // Real loss numbers for the downgrade warning (wired from usage-stats above).
  // Fallback 0 while the paid-plan query settles OR when it's disabled (FREE user
  // — who never reaches a downgrade anyway), so the dialog degrades to generic
  // loss copy rather than a wrong count.
  const downgradeStats: DowngradeWarningStats = {
    galleryCount: usage?.gallery_records ?? 0,
    pairedClientsCount: usage?.paired_clients ?? 0,
  };

  const handleSwitchToStylist = () => {
    switchRole.mutate({ account_type: AccountTypeValue.STYLIST });
  };

  /* ── Loading skeleton (mount-gate + loading-guard): the boxes of the final
     page (intro, plan-list header with the period switch, plan cards), so
     nothing jumps when the account and the price list arrive. ── */
  const loadingSkeleton = (
    <div className={styles.page} aria-busy='true'>
      <SkeletonAtom variant='rect' width='100%' height={72} />
      <SkeletonAtom variant='rect' width='100%' height={108} />
      <div className={styles.plansList}>
        {[0, 1, 2, 3].map(i => (
          <SkeletonAtom key={i} variant='rect' width='100%' height={380} />
        ))}
      </div>
    </div>
  );

  /* ── Mount-gate (hydration): SSR i first-CSR renderują identyczny skeleton,
     zanim error/treść (zależne od client-only sesji) się ujawnią ── */
  if (!mounted) {
    return loadingSkeleton;
  }

  /* ── Error — show retry instead of infinite skeleton (DECISION: error guard
     MUSI być przed loading guard, bo na błędzie isLoading=false ale plans=undefined
     → bez tego loading guard pokazywałby skeleton w nieskończoność).
     S26: tylko realny błąd fetchu — fallback Stripe (pricesUnavailable)
     renderuje normalny układ w trybie degraded, patrz usePricingPlans. ── */
  // Pełny błąd TYLKO bez danych: nieudane odświeżenie w tle (fokus okna,
  // invalidacja po zmianie planu) zostawia w cache ostatni stan konta i cennika,
  // a TanStack i tak ustawia `isError`. Wtedy zostaje zwykły układ strony.
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
  if (isLoading || !plans || !hasStylistAccount) {
    return loadingSkeleton;
  }

  /* ── Dual-role in CLIENT mode — billing is a STYLIST surface (checkout 403s
     by active role, per DECISION above); hasStylistAccount is already true here
     (pure clients redirected). Pre-empt the doomed mint + retry dead-loop. ── */
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
  const currentPlanData = plans[currentIndex];

  // What the Stripe mirror fields say (next payment, trial end, scheduled
  // cancellation, failed payment), not a blanket "subscription active".
  const status = resolvePlanStatusCopy(user?.stylist_account ?? null, lang);
  const heroTitle =
    currentPlanData !== undefined
      ? t('heroTitle', { plan: currentPlanData.name })
      : t('title');
  // ONE filled action on the screen: the recommended plan's button, or (top
  // tier, failed payment) the billing button. Never both.
  const recommendedPlanId = resolveRecommendedPlanId(
    plans,
    currentIndex,
    status.kind
  );

  const planTx: PlanTranslations = buildPlanTx(t);

  const checkoutPlanData =
    actions.checkoutPlan !== null
      ? plans.find(p => p.id === actions.checkoutPlan)
      : undefined;

  // The plan is named ONCE, in the intro. Free adds its limits there (it has
  // no billing card); a paid plan gets the billing card beside the intro from
  // 720px of the page's own width, under it on a phone.
  const hero = (
    <AppHeroOrganism
      title={heroTitle}
      {...(status.keys.heroMeta !== null
        ? { meta: t(status.keys.heroMeta) }
        : {})}
    />
  );

  return (
    <div className={styles.page}>
      <PageColumnsMolecule
        main={hero}
        aside={
          status.keys.title !== null ? (
            <BillingCardOrganism
              title={t(status.keys.title, { date: status.date })}
              body={t(status.keys.body)}
              isAlert={status.kind === 'pastDue'}
              manageLabel={t('manageBillingCta')}
              isManaging={actions.openingPortal}
              isPrimary={recommendedPlanId === null}
              // Degraded (Stripe fallback): the portal would fail as well.
              disabled={pricesUnavailable || actions.busy}
              onManage={actions.openBillingPortal}
              {...(actions.portalFailed && { error: t('portalError') })}
            />
          ) : null
        }
      />

      <section className={styles.plansSection}>
        <PlansHeaderMolecule
          title={t('plansTitle')}
          cycle={billingCycle}
          onCycleChange={setBillingCycle}
          monthlyLabel={t('billingMonthly')}
          yearlyLabel={t('billingYearly')}
          periodLabel={t('billingPeriodLabel')}
          hint={t(payBillingHintKey(checkoutPromo, billingCycle))}
        />

        {/* Degraded (fallback Stripe): ceny null → minus w slocie, akcje OFF. */}
        {pricesUnavailable && (
          <p className={styles.pricesUnavailableHint} role='status'>
            {t('pricesUnavailableHint')}
          </p>
        )}

        <div className={styles.plansList}>
          {plans.map((plan, index) => (
            <PlanCardOrganism
              key={plan.id}
              plan={plan}
              isCurrent={plan.id === currentPlan}
              isDowngrade={index < currentIndex}
              isRecommended={plan.id === recommendedPlanId}
              billingCycle={billingCycle}
              isPending={actions.pendingPlan === plan.id}
              disableActions={actions.busy || pricesUnavailable}
              hasError={actions.failedPlan === plan.id}
              onManage={actions.selectPlan}
              onContactSales={openContactMail}
              tx={planTx}
            />
          ))}
        </div>
      </section>

      <PayFaqOrganism title={t('faq.title')} entries={buildPayFaq(t)} />

      <DowngradeWarningDialogOrganism
        isOpen={actions.downgradeTarget !== null}
        onClose={actions.cancelDowngrade}
        onConfirm={actions.confirmDowngrade}
        stats={downgradeStats}
        currentPlan={currentPlan}
        targetPlan={actions.downgradeTarget ?? PricingPlanValue.FREE}
      />

      {/* FREE → paid: embedded checkout dialog (no portal bounce). Only a real,
          known paid plan opens it. */}
      {actions.checkoutPlan !== null && checkoutPlanData !== undefined && (
        <PlanCheckoutDialogOrganism
          planId={actions.checkoutPlan}
          billingPeriod={toBillingPeriod(billingCycle)}
          {...(checkoutPromo !== undefined ? { promo: checkoutPromo } : {})}
          titleId={checkoutDialogTitleId}
          title={t('checkoutDialogTitle', { plan: checkoutPlanData.name })}
          onClose={actions.checkoutClose}
        />
      )}
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
