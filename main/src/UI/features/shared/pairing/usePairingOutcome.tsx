import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { stylistDisplayName } from '../profile/stylist-display-name';
import { OutcomeStateMolecule } from '../../../components/OutcomeFeedback/OutcomeState.molecule';
import { PushSoftAskOrganism } from '../push/PushSoftAsk.organism';
import type { PairingAudience } from './pairingAudience';
export function usePairingOutcome(accountId?: string) {
  const t = useTranslations('components.outcomeFeedback');
  const labels = useTranslations('labels');
  const [result, setResult] = useState<{
    accountId: string;
    name: string;
    created: boolean;
    connected: boolean;
  } | null>(null);
  const confirm = (
    account: {
      account_id: string;
      display_name: string | null;
      business_name: string | null;
    },
    response: { status: string; created?: boolean }
  ) =>
    setResult({
      accountId: account.account_id,
      name: stylistDisplayName(account, labels('stylistFallback')),
      created: response.status === 'PENDING' && response.created === true,
      connected: response.status === 'ALREADY_PAIRED',
    });
  const feedback = (audience: PairingAudience) =>
    result !== null &&
    result.accountId === accountId &&
    audience === (result.connected ? 'clientPaired' : 'clientPending') ? (
      <>
        <OutcomeStateMolecule
          confirmed
          marked={result.created}
          message={t(
            result.connected
              ? 'pairAlreadyConnected'
              : result.created
                ? 'pairRequestPending'
                : 'pairAlreadyPending',
            { name: result.name }
          )}
        />
        {/* Notifications v2: the request waits for the stylist, the one
            moment a push obviously helps the client (soft ask). */}
        {!result.connected && <PushSoftAskOrganism moment='pairRequest' />}
      </>
    ) : null;
  return { confirm, feedback };
}
