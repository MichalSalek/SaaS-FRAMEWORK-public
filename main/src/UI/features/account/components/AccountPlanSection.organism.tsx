import { PlanDiscountsMolecule } from './PlanDiscounts.molecule';
import { SalonSetupEntryOrganism } from '../../salon-profile/SalonSetupEntry.organism';
import { OutcomeStateMolecule } from '../../../components/OutcomeFeedback/OutcomeState.molecule';
import { resolveEffectiveSubscriptionState } from '@kernel/domain/user-and-account/subscription-state';
import { getEffectivePricingPlan } from '@kernel/domain/pricing/effective-plan';
import { useTranslations } from 'next-intl';
import {
  getPlanDisplayName,
  PricingPlanValue,
} from '@kernel/domain/pricing/pricing.config';
import { SubscriptionStatusValue } from '@kernel/models/db_models.generated.dto';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { useCurrentLang } from '../../../hooks/useCurrentLang';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../../components/Button/LinkButton.atom';
import {
  CardMolecule,
  CardContentAtom,
} from '../../../components/Card/Card.molecule';
import { StatusPillAtom } from '../../../components/StatusPill/StatusPill.atom';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import { SkeletonAtom } from '../../../components/Skeleton/Skeleton.atom';
import {
  NavRowMolecule,
  NavRowListMolecule,
} from '../../../components/NavRow/NavRow.molecule';
import { resolvePlanFeatures } from '../../../../application/pricing/plan-features.catalog';
import { useUsageStats } from '../../shared/account/hooks/useUsageStats';
import { useAccountPayActions } from '../hooks/useAccountPayActions';
import { usePlanPortalReturn } from '../hooks/usePlanPortalReturn';
import {
  planHubStatus,
  formatPlanCharge,
  showPlanUpgrade,
} from '../AccountPlan.helpers';
import { formatDateLong } from '../../../../application/date/date.utils';
import { UsageStatsSectionOrganism } from './UsageStatsSection.organism';
import { DowngradeWarningDialogOrganism } from './DowngradeWarningDialog.organism';
import { toDowngradeWarningStats } from './downgradeWarning.helpers';
import styles from './AccountPlanSection.module.css';

export function AccountPlanSectionOrganism({
  showFavoriteStylists,
}: {
  showFavoriteStylists: boolean;
}) {
  const t = useTranslations('account.planHub');
  const tPay = useTranslations('account.pay');
  const tPlan = useTranslations('account.plan');
  const locale = useCurrentLang();
  const { data: user, refetch, isFetching } = useCurrentUserAccount();
  const usage = useUsageStats();
  const portal = usePlanPortalReturn();
  const account = user?.stylist_account;
  const plan = account?.pricing_plan ?? PricingPlanValue.FREE;
  const actions = useAccountPayActions({
    currentPlan: plan,
    billingPeriod: 'month',
  });
  if (portal.waiting) {
    return (
      <div className={styles.stack} aria-busy='true'>
        <CardMolecule>
          <CardContentAtom>
            <p role='status'>{t('refreshing')}</p>
          </CardContentAtom>
        </CardMolecule>
        <SkeletonAtom variant='rect' width='100%' height={160} />
      </div>
    );
  }
  if (account == null) {
    return null;
  }
  const status = planHubStatus(account, locale);
  const effectivePlan = getEffectivePricingPlan(account);
  const salonPlan =
    resolveEffectiveSubscriptionState(account) === 'salon_member'
      ? account.salon_plan
      : null;
  const salonOnly = Boolean(salonPlan) && status.kind === 'free';
  const showUpgrade = showPlanUpgrade(plan, status.kind, salonOnly);
  const name = getPlanDisplayName(
    status.kind === 'free' ? PricingPlanValue.FREE : plan
  );
  // Feature catalogue projection for the effective plan. A salon member
  // inherits Studio capabilities, but the owner lines (team accounts, salon
  // profile) belong only to an account with its own salon plan.
  const features = resolvePlanFeatures(effectivePlan, {
    includeOwnerOnly: PRICING_POLICY.LIMITS[plan].can_have_salon_profile,
  }).map(line => tPlan(line.key, line.params));
  const charge = formatPlanCharge(
    account.billing?.nextChargeAmount,
    account.billing?.currency,
    locale
  );
  const chargeAt = account.billing?.nextChargeAt;
  // A plan with no Stripe subscription (granted by an admin, or seeded) has
  // nothing to charge: without this guard it showed a "could not confirm
  // the amount" error with a retry that could never succeed.
  const billingApplies =
    (status.kind === 'trialing' || status.kind === 'active') &&
    account.billing?.pendingPayment == null &&
    account.admin_plan_override !== true &&
    account.subscription_status != null;
  const colors = {
    free: 'var(--color-text-secondary)',
    active: 'var(--color-success)',
    trialing: 'var(--color-info)',
    canceling: 'var(--color-warning)',
    pastDue: 'var(--color-error)',
  };
  return (
    <div className={styles.stack}>
      {portal.timedOut ? (
        <ErrorStateMolecule
          message={t('returnPending')}
          retryLabel={tPay('retry')}
          isRetrying={isFetching}
          onRetry={portal.retry}
        />
      ) : portal.returned ? (
        <p role='status'>{t('returned')}</p>
      ) : null}
      {salonPlan && (
        <CardMolecule>
          <CardContentAtom>
            <h2 className={styles.heading}>
              {t('salonMember', {
                plan: getPlanDisplayName(salonPlan.pricing_plan),
                salon: salonPlan.salon_name,
              })}
            </h2>
            <p>{t('salonMemberExplanation')}</p>
            {!salonOnly && (
              <p>
                {t('ownSubscriptionRemains', {
                  plan: getPlanDisplayName(plan),
                })}
              </p>
            )}
          </CardContentAtom>
        </CardMolecule>
      )}
      {!salonOnly && (
        <CardMolecule>
          <CardContentAtom>
            <div className={styles.stack}>
              <div className={styles.summaryHeader}>
                <OutcomeStateMolecule
                  confirmed={
                    status.kind === 'active' || status.kind === 'trialing'
                  }
                  marked={false}>
                  <StatusPillAtom
                    color={colors[status.kind]}
                    label={t(`status.${status.kind}`)}
                  />
                </OutcomeStateMolecule>
                {account.subscription_status != null && (
                  <ButtonAtom
                    className={styles.portalButton}
                    variant='outlined'
                    disabled={actions.busy}
                    loading={actions.openingPortal}
                    onClick={actions.openBillingPortal}>
                    {t('manageBilling')}
                  </ButtonAtom>
                )}
              </div>
              <h2 className={styles.heading}>
                {t(
                  `summary.${status.kind === 'canceling' && account.subscription_status === SubscriptionStatusValue.TRIALING ? 'cancelingTrial' : status.kind}`,
                  { plan: name, date: status.date, days: status.days }
                )}
              </h2>
              {status.kind === 'trialing' && <p>{t('trialConverts')}</p>}
              <PlanDiscountsMolecule discounts={account.billing?.discounts} />
              {billingApplies &&
                (charge !== null && chargeAt != null ? (
                  <p>
                    {t(
                      status.kind === 'trialing' ? 'firstCharge' : 'nextCharge',
                      {
                        amount: charge,
                        date: formatDateLong(chargeAt, locale).replaceAll(
                          ' ',
                          '\u00a0'
                        ),
                      }
                    )}
                  </p>
                ) : (
                  <div>
                    <p>{t('chargeUnavailable')}</p>
                    <ButtonAtom
                      variant='outlined'
                      disabled={isFetching}
                      onClick={() => void refetch()}>
                      {tPay('retry')}
                    </ButtonAtom>
                  </div>
                ))}
              {!salonPlan && status.kind === 'canceling' && (
                <p>
                  {t('cancelConsequences', {
                    gallery: PRICING_POLICY.LIMITS.FREE.max_gallery_records,
                    clients: PRICING_POLICY.LIMITS.FREE.max_paired_clients,
                  })}
                </p>
              )}
              {status.kind === 'pastDue' && <p>{t('paymentFix')}</p>}
            </div>
          </CardContentAtom>
        </CardMolecule>
      )}
      {showUpgrade && (
        <LinkButtonAtom href={ROUTES_FRONT.USER_ACCOUNT_PAY} variant='primary'>
          {t('upgradePlan')}
        </LinkButtonAtom>
      )}
      {!salonPlan &&
        status.kind === 'free' &&
        usage.data !== undefined &&
        (usage.data.gallery_records >
          PRICING_POLICY.LIMITS.FREE.max_gallery_records ||
          usage.data.paired_clients >
            PRICING_POLICY.LIMITS.FREE.max_paired_clients) && (
          <p>
            {tPay('downgradeWarning.freeLimitsReminder', {
              gallery: PRICING_POLICY.LIMITS.FREE.max_gallery_records,
              clients: PRICING_POLICY.LIMITS.FREE.max_paired_clients,
            })}
          </p>
        )}
      <SalonSetupEntryOrganism />
      <section className={styles.stack}>
        <h2 className={styles.heading}>{t('includes')}</h2>
        {/* Lista z katalogu cech (kernel), bez czekania na ceny ze Stripe. */}
        <NavRowListMolecule ariaLabel={t('includes')}>
          {features.map(feature => (
            <NavRowMolecule key={feature} label={feature} />
          ))}
        </NavRowListMolecule>
        <UsageStatsSectionOrganism
          showFavoriteStylists={showFavoriteStylists}
        />
      </section>
      {!salonOnly && (!showUpgrade || status.kind !== 'free') && (
        <div className={styles.actions}>
          {status.kind === 'pastDue' || status.kind === 'canceling' ? (
            <ButtonAtom
              variant='primary'
              disabled={actions.busy}
              onClick={actions.openBillingPortal}>
              {t(status.kind === 'canceling' ? 'keepPlan' : 'fixPayment')}
            </ButtonAtom>
          ) : !showUpgrade ? (
            <LinkButtonAtom
              href={ROUTES_FRONT.USER_ACCOUNT_PAY}
              variant='primary'>
              {t('changePlan')}
            </LinkButtonAtom>
          ) : null}
          {(status.kind === 'pastDue' || status.kind === 'canceling') && (
            <LinkButtonAtom
              href={ROUTES_FRONT.USER_ACCOUNT_PAY}
              variant='outlined'>
              {t('changePlan')}
            </LinkButtonAtom>
          )}
          {status.kind !== 'free' && status.kind !== 'canceling' && (
            <ButtonAtom
              variant='ghost'
              disabled={actions.busy}
              onClick={() =>
                salonPlan
                  ? actions.openCancellationPortal()
                  : actions.selectPlan(PricingPlanValue.FREE)
              }>
              {t('cancelPlan')}
            </ButtonAtom>
          )}
        </div>
      )}
      {status.kind === 'canceling' && <p>{t('keepInPortal')}</p>}
      {actions.portalFailed && <p role='alert'>{tPay('portalError')}</p>}
      <DowngradeWarningDialogOrganism
        isOpen={actions.downgradeTarget !== null}
        onClose={actions.cancelDowngrade}
        onConfirm={actions.confirmDowngrade}
        currentPlan={plan}
        targetPlan={PricingPlanValue.FREE}
        stats={toDowngradeWarningStats(usage.data)}
      />
    </div>
  );
}
