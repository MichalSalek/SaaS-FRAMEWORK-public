// StylistPairRequests — connection requests from the permanent QR code.
// A client asked from the public profile -> PENDING pair; the stylist
// accepts/declines with one tap. The section renders ONLY when there are
// requests (empty = no noise) and stands FIRST on „Twoje klientki”, above the
// list: it is the only thing that waits for the stylist. It left the QR screen
// because a client looks at that one and a request carries another person's name.
// Stack: TQ v5 + Card + Phosphor.
//
// Exception to „no noise”: the first fetch FAILED. Then we do not know whether
// requests exist, so emptiness would lie „nobody is waiting”; a compact error
// with retry shows instead. A failed BACKGROUND poll (data already there) keeps
// the last known list: requests stay tappable and the interval retries itself.

import { useState } from 'react';
import { OutcomeStateMolecule } from '../../components/OutcomeFeedback/OutcomeState.molecule';
import { useLocale, useTranslations } from 'next-intl';
import { capturePosthog } from '../../../application/analytics/posthog-client';
import { CheckIcon, XIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { CardMolecule } from '../../components/Card/Card.molecule';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { NavRowMolecule } from '../../components/NavRow/NavRow.molecule';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import { getEffectivePricingPlan } from '@kernel/domain/pricing/effective-plan';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { formatDate } from '../../../application/date/date.utils';
import { pushNewSnackbar } from '../../../application/app-snackbar/appSnackbar.possibilities.api';
import { isIOError } from '../../../application/http/io';
import { flowErrorCode } from '../shared/analytics/flowErrorCode';
import {
  usePendingRequests,
  useRespondPairRequest,
} from '../shared/pairing/hooks/usePairRequests';
import { useUsageStats } from '../shared/account/hooks/useUsageStats';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import {
  getQuotaFailureFeature,
  resolveQuotaSnapshot,
} from '../../../application/pricing/quota.helpers';
import { QuotaNoticeMolecule } from '../shared/upsell/QuotaNotice.molecule';
import { QuotaUpgradeDialogOrganism } from '../shared/upsell/QuotaUpgradeDialog.organism';
import styles from './PairingPage.module.css';
import rowStyles from './StylistPairRequests.module.css';

type PairingPageT = ReturnType<typeof useTranslations<'pages.pairing'>>;

export function StylistPairRequestsOrganism({ t }: { t: PairingPageT }) {
  const lang = useCurrentLang();
  const feedback = useTranslations('components.outcomeFeedback');
  const [accepted, setAccepted] = useState<{ id: string; name: string } | null>(
    null
  );
  const [declined, setDeclined] = useState(false);
  const [quotaUpgradeOpen, setQuotaUpgradeOpen] = useState(false);
  const locale = useLocale();
  const tButtons = useTranslations('buttons');
  const pendingQuery = usePendingRequests(true);
  const respondMutation = useRespondPairRequest();
  const requests = pendingQuery.data?.requests ?? [];
  const { data: usage } = useUsageStats();
  const { data: currentUser } = useCurrentUserAccount();
  const currentPlan = currentUser?.stylist_account
    ? getEffectivePricingPlan(currentUser.stylist_account)
    : PricingPlanValue.FREE;
  const clientsQuota = resolveQuotaSnapshot(
    usage?.paired_clients,
    usage?.limits.max_paired_clients
  );

  // The error state is a surface of its own: it stands in for the box.
  if (pendingQuery.isError && pendingQuery.data === undefined) {
    return (
      <ErrorStateMolecule
        message={t('requestsLoadError')}
        retryLabel={tButtons('retry')}
        onRetry={() => void pendingQuery.refetch()}
        isRetrying={pendingQuery.isFetching}
      />
    );
  }

  if (requests.length === 0 && !accepted && !declined) {
    return null;
  }

  // One mutation serves every row, so the whole list is blocked while it is in
  // flight, but „in progress” (aria-busy) is announced only on the clicked button.
  const respondingTo = respondMutation.isPending
    ? respondMutation.variables
    : undefined;

  const handleRespond = (pair_id: string, action: 'ACCEPT' | 'DECLINE') => {
    respondMutation.mutate(
      { pair_id, action },
      {
        onSuccess: data => {
          capturePosthog(
            data.status === 'ACTIVE'
              ? 'pair_request_accepted'
              : 'pair_request_declined',
            { pair_id }
          );
          if (data.status === 'ACTIVE') {
            setAccepted({
              id: pair_id,
              name:
                requests
                  .find(request => request.pair_id === pair_id)
                  ?.name?.trim() || t('clientAnonymous'),
            });
            setDeclined(false);
          } else {
            setAccepted(null);
            setDeclined(true);
          }
        },
        onError: error => {
          const errorCode = flowErrorCode(error);
          const errorData = isIOError(error) ? error.httpError.data : undefined;
          if (action !== 'ACCEPT') {
            return;
          }
          if (
            getQuotaFailureFeature('clients', errorCode, errorData) ===
            'clients'
          ) {
            setQuotaUpgradeOpen(true);
            return;
          }
          if (
            errorCode === APP_EVENTS.INFO.APPLICATION.PLAN_LIMIT_REACHED_INFO &&
            isRecord(errorData) &&
            errorData.planType === 'PLATFORM'
          ) {
            pushNewSnackbar(t('requestClientLimitError'), 'error');
            return;
          }
          if (
            errorCode.startsWith('PAIR') ||
            errorCode === APP_EVENTS.INFO.APPLICATION.PLAN_LIMIT_REACHED_INFO
          ) {
            pushNewSnackbar(t('requestAcceptError'), 'error');
          }
        },
      }
    );
  };

  return (
    <div className={styles.requestsBlock}>
      {accepted && (
        <OutcomeStateMolecule
          confirmed
          completionKey={accepted.id}
          message={feedback('pairedWithClient', { name: accepted.name })}
        />
      )}
      {declined && <span role='status'>{t('requestDeclined')}</span>}
      {requests.length > 0 && (
        <CardMolecule variant='outlined'>
          <div className={styles.requestsContent}>
            <div className={styles.requestsIntro}>
              {/* The count lives in the hero meta („2 prośby czekają”); the
                heading only names the box. */}
              <TypographyAtom
                variant='h4'
                as='h2'
                className={styles.requestsTitle}>
                {t('requestsTitle')}
              </TypographyAtom>
              <TypographyAtom
                variant='body2'
                className={styles.requestsBody}
                lang={lang}>
                {t('requestsBody')}
              </TypographyAtom>
            </div>
            {(clientsQuota.state === 'one_remaining' ||
              clientsQuota.state === 'exhausted') && (
              <QuotaNoticeMolecule feature='clients' quota={clientsQuota} />
            )}
            <ul className={styles.requestsList}>
              {requests.map(request => {
                const name = request.name?.trim() || t('clientAnonymous');
                const when = formatDate(request.requested_at, locale);
                const where = request.place?.trim() ?? '';
                const message = request.note?.trim() ?? '';
                return (
                  <li key={request.pair_id} className={styles.requestRow}>
                    <div className={rowStyles.fill}>
                      <NavRowMolecule
                        label={name}
                        description={
                          where.length > 0
                            ? t('requestApproxLocation', { place: where })
                            : t('requestNoLocation')
                        }
                        note={
                          <span className={rowStyles.details}>
                            <time
                              dateTime={request.requested_at}
                              className={rowStyles.when}>
                              {when}
                            </time>
                            {message.length > 0 && <span>{message}</span>}
                          </span>
                        }
                        leading={
                          <AvatarAtom
                            name={name}
                            src={request.avatar_url ?? undefined}
                            size='md'
                            decorative
                          />
                        }
                      />
                    </div>
                    <div className={styles.requestActions}>
                      <ButtonAtom
                        variant='primary'
                        size='sm'
                        icon={<CheckIcon size={16} weight='bold' />}
                        disabled={respondMutation.isPending}
                        aria-busy={
                          respondingTo?.pair_id === request.pair_id &&
                          respondingTo.action === 'ACCEPT'
                        }
                        onClick={() => handleRespond(request.pair_id, 'ACCEPT')}
                        className='press-feedback'>
                        {t('requestAccept')}
                      </ButtonAtom>
                      <ButtonAtom
                        variant='outlined'
                        size='sm'
                        icon={<XIcon size={16} />}
                        disabled={respondMutation.isPending}
                        aria-busy={
                          respondingTo?.pair_id === request.pair_id &&
                          respondingTo.action === 'DECLINE'
                        }
                        onClick={() =>
                          handleRespond(request.pair_id, 'DECLINE')
                        }
                        className='press-feedback'>
                        {t('requestDecline')}
                      </ButtonAtom>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </CardMolecule>
      )}
      <QuotaUpgradeDialogOrganism
        open={quotaUpgradeOpen}
        feature='clients'
        currentPlan={currentPlan}
        onClose={() => setQuotaUpgradeOpen(false)}
      />
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
