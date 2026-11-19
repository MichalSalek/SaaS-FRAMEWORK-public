import { useId } from 'react';
import { useTranslations } from 'next-intl';
import {
  getPlanDisplayName,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { PlanDecisionSurfaceOrganism } from '../../shared/pricing/PlanDecisionSurface.organism';
import { usePlanDecisionBenefits } from '../../shared/pricing/hooks/usePlanDecisionBenefits';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import type { PlanChangePreview } from '../hooks/usePlanChangePreview';
import { PlanChangeQuoteMolecule } from './PlanChangeQuote.molecule';
import styles from './DowngradeWarningDialog.module.css';

export function PlanChangeConfirmationOrganism({
  planId,
  currentPlan,
  preview,
  busy,
  failed,
  onConfirm,
  onClose,
}: {
  planId: PricingPlan;
  currentPlan: PricingPlan;
  preview: PlanChangePreview;
  busy: boolean;
  failed: boolean;
  onConfirm: (quoteId?: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('account.pay.changeConfirmation');
  const titleId = useId();
  const benefits = usePlanDecisionBenefits(currentPlan, planId);
  return (
    <PlanDecisionSurfaceOrganism
      title={t(planId === currentPlan ? 'billingTitle' : 'title', {
        plan: getPlanDisplayName(planId),
      })}
      titleId={titleId}
      benefits={benefits}
      dismissLocked={busy}
      onClose={onClose}>
      {close => (
        <>
          <p className={styles.subtitle}>{t('body')}</p>
          <PlanChangeQuoteMolecule preview={preview} rejected={failed} />
          <div className={styles.actions}>
            <ButtonAtom variant='outlined' disabled={busy} onClick={close}>
              {t('back')}
            </ButtonAtom>
            <ButtonAtom
              variant='primary'
              loading={busy}
              disabled={!preview.canConfirm || busy || failed}
              onClick={() => {
                if (preview.canConfirm && !failed) {
                  onConfirm(preview.data?.quoteId);
                }
              }}>
              {t('confirm')}
            </ButtonAtom>
          </div>
        </>
      )}
    </PlanDecisionSurfaceOrganism>
  );
}
