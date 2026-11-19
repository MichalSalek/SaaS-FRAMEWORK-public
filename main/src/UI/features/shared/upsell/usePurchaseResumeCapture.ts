import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { trackFlowStep } from '../../../../application/analytics/flow-events';
import {
  savePurchaseResume,
  type PurchaseResumeAction,
} from '../../../../application/client-device-storage/purchase-resume';

/** Capture metadata at the explicit upgrade click; draft contents stay in their own adapter. */
export function usePurchaseResumeCapture() {
  const { data: user } = useCurrentUserAccount();
  return (action: PurchaseResumeAction): void => {
    const accountId = user?.stylist_account?.account_id;
    if (
      !user?.id ||
      !accountId ||
      typeof globalThis.crypto?.randomUUID !== 'function'
    ) {
      return;
    }
    const saved = savePurchaseResume({
      id: globalThis.crypto.randomUUID(),
      userId: user.id,
      accountId,
      createdAt: Date.now(),
      action,
      sessionId: null,
    });
    if (saved) {
      trackFlowStep('purchase_resume', 'saved', {
        action: action.kind,
        measurement_version: 1,
      });
    }
  };
}
