import type { CheckoutAct } from '../checkout-act.helpers';
import type { CheckoutFormTranslations } from './CheckoutForm.types';
import {
  CheckoutRecoverViewMolecule,
  CheckoutStatusActionsMolecule,
  CheckoutStatusViewMolecule,
} from './CheckoutStatusView.molecule';

/** No payment action after a confirmed redirect or without a known amount. */
export function renderCheckoutBlockingViewMolecule(
  act: CheckoutAct,
  state: {
    timedOut: boolean;
    addressReady: boolean;
    confirming: boolean;
    redirectInFlight: boolean;
  },
  tx: CheckoutFormTranslations,
  onRetry: (() => void) | undefined,
  cancel: { label: string; onClick: () => void } | undefined
) {
  if (state.timedOut) {
    return (
      <CheckoutStatusViewMolecule
        variant='info'
        role='status'
        text={act.stillProcessing}>
        <CheckoutStatusActionsMolecule cancel={cancel} />
      </CheckoutStatusViewMolecule>
    );
  }
  if (
    act.amountUnknown &&
    state.addressReady &&
    !state.confirming &&
    !state.redirectInFlight
  ) {
    return (
      <CheckoutRecoverViewMolecule
        text={act.amountUnknownText}
        retryLabel={tx.retry}
        onRetry={onRetry}
        cancel={cancel}
      />
    );
  }
  return null;
}
