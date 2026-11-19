import { formatMoney } from '@kernel/domain/pricing/money.format';
import { SALON_SETUP_HREF } from '../salon-profile/salonSetup.helpers';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { trackFlowStep } from '../../../application/analytics/flow-events';
import { armPurchaseResumeOutcome } from '../../../application/analytics/purchase-resume-outcome';
import { useResumeUploadDraft } from './hooks/useResumeUploadDraft';
import { useRouter } from 'next/router';
import {
  getPlanDisplayName,
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { resolveSubscriptionState } from '@kernel/domain/user-and-account/subscription-state';
import { SuccessSceneOrganism } from '../../components/OutcomeFeedback/SuccessScene.organism';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { buildAccountSectionHref } from '../../../application/policies/account-sections.config';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { usePricingPlans } from '../shared/pricing/hooks/usePricingPlans';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import { formatDateLong } from '../../../application/date/date.utils';
import styles from './CheckoutReturnPage.module.css';
import {
  consumePurchaseResume,
  readPurchaseResume,
  resolvePurchaseResume,
  type PurchaseResumeIntent,
} from '../../../application/client-device-storage/purchase-resume';

export function CheckoutSuccessOrganism({
  plan,
  resume,
}: {
  plan: PricingPlan;
  resume?: { userId: string; accountId: string; sessionId: string };
}) {
  const t = useTranslations('account.checkout.return');
  const router = useRouter();
  const [intent, setIntent] = useState<PurchaseResumeIntent | null>(null);
  const offeredIntent = useRef<string | null>(null);
  const resumeUserId = resume?.userId;
  const resumeAccountId = resume?.accountId;
  const resumeSessionId = resume?.sessionId;
  useEffect(() => {
    if (!resumeUserId || !resumeAccountId || !resumeSessionId) {
      setIntent(null);
      return;
    }
    const saved = readPurchaseResume({
      userId: resumeUserId,
      accountId: resumeAccountId,
    });
    setIntent(saved?.sessionId === resumeSessionId ? saved : null);
  }, [resumeUserId, resumeAccountId, resumeSessionId]);
  const locale = useCurrentLang();
  const tSetup = useTranslations('components.salonSetupEntry');
  const accountQuery = useCurrentUserAccount();
  const user = accountQuery.data;
  const pricing = usePricingPlans();
  const account = user?.stylist_account;
  const trial = account && resolveSubscriptionState(account) === 'trialing';
  const billing = account?.billing;
  const amount =
    billing?.nextChargeAmount != null && billing.currency
      ? formatMoney(billing.nextChargeAmount, billing.currency, locale)
      : null;
  const features = pricing.data?.find(item => item.id === plan)?.features;
  const team = PRICING_POLICY.LIMITS[plan].can_have_salon_profile;
  const brand = plan === PricingPlanValue.PRO_PLUS;
  const resumeLabels = {
    upload: t('resumeUpload'),
    gallery: t('resumeGallery'),
    connections: t('resumeConnections'),
    client: t('resumeClient'),
    brand: t('resumeBrand'),
    salon: t('resumeSalon'),
    team: t('resumeTeam'),
  };
  const destination =
    intent &&
    resume &&
    intent.userId === resume.userId &&
    intent.accountId === resume.accountId &&
    intent.sessionId === resume.sessionId
      ? resolvePurchaseResume(intent, plan)
      : null;
  const uploadDraft = useResumeUploadDraft(
    intent?.action.kind === 'upload' ? (resume?.userId ?? null) : null
  );

  useEffect(() => {
    if (destination && intent && offeredIntent.current !== intent.id) {
      offeredIntent.current = intent.id;
      trackFlowStep('purchase_resume', 'offered', {
        action: intent.action.kind,
        measurement_version: 1,
      });
    }
  }, [destination, intent]);

  return (
    <div className={styles.successPage} data-fill-shell=''>
      <SuccessSceneOrganism
        presentation='glory'
        actionDock
        titleId='checkout-success-title'
        title={t('successTitle', { plan: getPlanDisplayName(plan) })}
        body={
          <>
            <p className={styles.body}>
              {trial && account.trial_ends_at
                ? t('trialConfirmed', {
                    date: formatDateLong(
                      account.trial_ends_at,
                      locale
                    ).replaceAll(' ', '\u00a0'),
                  })
                : t('paidConfirmed')}
            </p>
            {team && <p className={styles.body}>{t('salonGalleryReady')}</p>}
            {trial && (
              <p className={styles.body}>
                {amount && billing?.nextChargeAt
                  ? t('firstCharge', {
                      amount: amount.replaceAll(' ', '\u00a0'),
                      date: formatDateLong(
                        billing.nextChargeAt,
                        locale
                      ).replaceAll(' ', '\u00a0'),
                    })
                  : t('billingPending')}
              </p>
            )}
            {trial && (amount === null || !billing?.nextChargeAt) && (
              <ButtonAtom
                variant='outlined'
                loading={accountQuery.isFetching}
                onClick={() => void accountQuery.refetch()}>
                {t('ctaRetry')}
              </ButtonAtom>
            )}
          </>
        }
        aside={
          pricing.isLoading ? (
            <SkeletonAtom variant='rect' width='100%' height={120} />
          ) : pricing.isError ? (
            <ErrorStateMolecule
              message={t('readError')}
              retryLabel={t('ctaRetry')}
              isRetrying={pricing.isFetching}
              onRetry={() => void pricing.refetch()}
            />
          ) : (
            <ul className={styles.features}>
              {features?.map(feature => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          )
        }
        actions={
          <>
            {destination && intent && resume ? (
              <ButtonAtom
                variant='primary'
                size='lg'
                loading={
                  intent.action.kind === 'upload' && uploadDraft === null
                }
                onClick={() => {
                  const latest = readPurchaseResume(resume);
                  if (
                    !latest ||
                    latest.id !== intent.id ||
                    latest.sessionId !== resume.sessionId
                  ) {
                    setIntent(null);
                    return;
                  }
                  void router
                    .push(destination.href)
                    .then(success => {
                      if (success) {
                        armPurchaseResumeOutcome(intent.action.kind);
                        trackFlowStep('purchase_resume', 'resumed', {
                          action: intent.action.kind,
                          measurement_version: 1,
                        });
                        consumePurchaseResume(
                          resume,
                          intent.id,
                          resume.sessionId
                        );
                      }
                    })
                    .catch(() => {
                      /* preserve intent on a failed navigation */
                    });
                }}>
                {intent.action.kind === 'upload' && uploadDraft === false
                  ? t('resumeUploadNew')
                  : resumeLabels[intent.action.kind]}
              </ButtonAtom>
            ) : (
              <LinkButtonAtom
                href={
                  team
                    ? SALON_SETUP_HREF
                    : brand
                      ? `${ROUTES_FRONT.STYLIST_PROFILE_MANAGE}?profile=personal#brand-colour`
                      : ROUTES_FRONT.GALLERY
                }
                variant='primary'
                size='lg'>
                {team
                  ? tSetup('start')
                  : brand
                    ? t('ctaBrand')
                    : t('ctaGallery')}
              </LinkButtonAtom>
            )}
            {destination && intent && resume && (
              <ButtonAtom
                variant='text'
                onClick={() => {
                  trackFlowStep('purchase_resume', 'dismissed', {
                    action: intent.action.kind,
                    measurement_version: 1,
                  });
                  consumePurchaseResume(resume, intent.id, resume.sessionId);
                  setIntent(null);
                }}>
                {t('resumeDismiss')}
              </ButtonAtom>
            )}
            <LinkButtonAtom
              href={buildAccountSectionHref('plan')}
              variant='outlined'>
              {t('ctaPlan')}
            </LinkButtonAtom>
          </>
        }
      />
    </div>
  );
}
