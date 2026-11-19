import { useEffect } from 'react';
import { TrendUpIcon } from '@phosphor-icons/react';
import {
  getPlanDisplayName,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import {
  getLowestEligibleUpgradePlan,
  getQuotaUpgradeRoute,
  type QuotaFeature,
} from '../../../../application/pricing/quota.helpers';
import { capturePosthog } from '../../../../application/analytics/posthog-client';
import { bypassLeaveGuard } from '../../../../application/routing/leave-guard';
import { AppDialogAtom } from '../../../primitives/AppDialog.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../../components/Button/LinkButton.atom';
import { buildPlanPayDeepLink } from '../pricing/pricingFunnelHref';
import { useQuotaTranslations } from './quotaTranslations';
import { useRouter } from 'next/router';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { usePurchaseResumeCapture } from './usePurchaseResumeCapture';

export function QuotaUpgradeDialogOrganism({
  open,
  feature,
  currentPlan,
  onClose,
}: {
  open: boolean;
  feature: QuotaFeature;
  currentPlan: PricingPlan;
  onClose: () => void;
}) {
  const t = useQuotaTranslations();
  const router = useRouter();
  const captureResume = usePurchaseResumeCapture();
  const targetPlan = getLowestEligibleUpgradePlan(feature, currentPlan);

  useEffect(() => {
    if (open && targetPlan !== null) {
      capturePosthog('upgrade_prompt_shown', {
        trigger: `${feature}_limit`,
        current_plan: currentPlan,
        target_plan: targetPlan,
      });
    }
  }, [currentPlan, feature, open, targetPlan]);

  if (targetPlan === null) {
    return null;
  }

  const destination = getQuotaUpgradeRoute(targetPlan);
  const targetName = getPlanDisplayName(targetPlan);
  const currentName = getPlanDisplayName(currentPlan);
  const href =
    destination.kind === 'contact'
      ? destination.href
      : buildPlanPayDeepLink(destination.planId, 'month');
  const title =
    destination.kind === 'contact'
      ? t('components.quotaUpgrade.contactTitle', { plan: targetName })
      : t('components.quotaUpgrade.title');
  const description = t(
    destination.kind === 'contact'
      ? `components.quotaUpgrade.contactBody.${feature}`
      : `components.quotaUpgrade.body.${feature}`,
    {
      currentPlan: currentName,
      plan: targetName,
    }
  );
  const actionLabel =
    destination.kind === 'contact'
      ? t('components.quotaUpgrade.contact', { plan: targetName })
      : t('components.quotaUpgrade.upgrade', { plan: targetName });

  return (
    <AppDialogAtom
      open={open}
      onOpenChange={nextOpen => !nextOpen && onClose()}>
      <AppDialogAtom.Content title={title} description={description}>
        <AppDialogAtom.Actions>
          <LinkButtonAtom
            href={href}
            variant='primary'
            size='md'
            icon={<TrendUpIcon size={16} weight='bold' />}
            onClick={() => {
              if (destination.kind !== 'contact') {
                if (router.pathname === ROUTES_FRONT.GALLERY_UPLOAD_ASSET) {
                  captureResume({ kind: 'upload' });
                } else if (router.pathname === ROUTES_FRONT.GALLERY) {
                  captureResume({ kind: 'gallery' });
                } else if (router.pathname === ROUTES_FRONT.SALON_STAFF) {
                  captureResume({ kind: 'team' });
                } else if (feature === 'clients') {
                  captureResume({ kind: 'connections' });
                }
              }
              capturePosthog('upgrade_prompt_clicked', {
                trigger: `${feature}_limit`,
                current_plan: currentPlan,
                target_plan: targetPlan,
              });
              // The selected upgrade action is an intentional in-app detour; the
              // upload draft is retained in module memory and will be restored on return.
              bypassLeaveGuard();
              onClose();
            }}>
            {actionLabel}
          </LinkButtonAtom>
          <ButtonAtom variant='outlined' size='md' onClick={onClose}>
            {t('components.quotaUpgrade.back')}
          </ButtonAtom>
        </AppDialogAtom.Actions>
      </AppDialogAtom.Content>
    </AppDialogAtom>
  );
}
