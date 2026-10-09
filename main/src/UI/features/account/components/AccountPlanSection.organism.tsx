// UI/features/account/components/AccountPlanSection.tsx
// Current plan badge + upgrade CTA -> /app/user/account/pay.
// Renders only for STYLIST accounts (clients have no pricing plan).
// Stack: CSS Modules + Phosphor Icons.

import { CrownIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  getPlanDisplayName,
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { LinkButtonAtom } from '../../../components/Button/LinkButton.atom';
import { buildPlanPayDeepLink } from '../../shared/pricing/pricingFunnelHref';
import {
  CardMolecule,
  CardContentAtom,
  CardHeaderAtom,
} from '../../../components/Card/Card.molecule';
import { PlanBadgeAtom } from '../../../components/PlanBadge/PlanBadge.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import styles from '../AccountPage.module.css';

/* ─── Props ─── */

interface AccountPlanSectionProps {
  plan: PricingPlan;
}

/* ─── Component ─── */

export function AccountPlanSectionOrganism({ plan }: AccountPlanSectionProps) {
  const t = useTranslations('account.plan');

  const PLAN_DESCRIPTION: Record<PricingPlan, string> = {
    FREE: t('descFree'),
    PRO: t('descPro'),
    PRO_PLUS: t('descProPlus'),
    STUDIO: t('descStudio'),
    SCALE: t('descScale'),
  };

  // P1: a FREE stylist entering the pay page from settings carries the
  // recommended plan (Pro) + billing period so the pay page pre-selects it and
  // auto-opens checkout — same single-step funnel as the /pricing CTAs (no second
  // plan choice). A paying stylist deep-links bare (she manages, not picks).
  const payHref =
    plan === PricingPlanValue.FREE
      ? buildPlanPayDeepLink(PricingPlanValue.PRO, 'month')
      : ROUTES_FRONT.USER_ACCOUNT_PAY;

  return (
    <CardMolecule variant='outlined' className={styles.planCard}>
      <CardHeaderAtom>
        <div className={styles.planNameRow}>
          <CrownIcon size={20} />
          <TypographyAtom variant='h4'>{t('sectionTitle')}</TypographyAtom>
        </div>
      </CardHeaderAtom>
      <CardContentAtom>
        <div className={styles.planInfo}>
          <div className={styles.planBadgeSlot}>
            {plan === PricingPlanValue.FREE ? (
              <span className={styles.planBadgeInline}>
                {getPlanDisplayName(plan)}
              </span>
            ) : (
              <PlanBadgeAtom plan={plan} />
            )}
          </div>
          <TypographyAtom variant='body2'>
            {PLAN_DESCRIPTION[plan]}
          </TypographyAtom>
        </div>
        {/* className = .planLink only: it carries the intended margin-top spacing
            above the CTA. The old inner-button .upgradeBtn (margin:0) is dropped —
            on a single anchor its margin reset would tie specificity with and clobber
            .planLink's margin-top. Buttons have no intrinsic margin to reset anyway. */}
        {/* Free: wybór planu to najcenniejsza akcja tej sekcji, więc dostaje
            wypełnienie. Płatny plan: zmiana jest poboczna, zostaje cicha. */}
        <LinkButtonAtom
          href={payHref}
          variant={plan === PricingPlanValue.FREE ? 'primary' : 'outlined'}
          size='md'
          direction='forward'
          className={styles.planLink}>
          {plan === PricingPlanValue.FREE ? t('chooseCta') : t('manageCta')}
        </LinkButtonAtom>
      </CardContentAtom>
    </CardMolecule>
  );
}
