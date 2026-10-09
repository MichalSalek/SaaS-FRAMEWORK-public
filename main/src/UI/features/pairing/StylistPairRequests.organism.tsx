// StylistPairRequests — prośby o połączenie ze stałego kodu QR (2026-07-11).
// Klientka poprosiła z publicznego profilu → para PENDING; stylistka
// akceptuje/odrzuca 1 tapem. Sekcja renderuje się TYLKO gdy są prośby
// (puste = zero szumu) i stoi PIERWSZA na ekranie „Twoje klientki”, nad
// listą: to jedyna rzecz, która na stylistkę czeka (S126). Do 2026-10-09
// stała nad kodem na ekranie Połączenie; zeszła stamtąd razem z listą, bo
// tamten ekran ogląda klientka, a prośba niesie imię innej osoby.
// Stack: TQ v5 + Card + Phosphor.
//
// Wyjątek od „zero szumu": pierwsze pobranie PADŁO. Wtedy nie wiemy, czy
// prośby są, więc pustka kłamałaby „nikt nie czeka" — klientka stojąca przy
// fotelu z wysłaną prośbą znikała bez śladu. Zwarty moduł błędu z ponowieniem.
// Nieudany poll W TLE (dane już są) zostawia ostatnią znaną listę: prośby są
// nadal klikalne, a interwał sam spróbuje znowu.

import { useLocale, useTranslations } from 'next-intl';
import posthog from 'posthog-js';
import { CheckIcon, XIcon } from '@phosphor-icons/react';
import { pushNewSnackbar } from '../../../application/app-snackbar/appSnackbar.possibilities.api';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { CardMolecule } from '../../components/Card/Card.molecule';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import { formatDate } from '../../../application/date/date.utils';
import {
  usePendingRequests,
  useRespondPairRequest,
} from '../shared/pairing/hooks/usePairRequests';
import { isUnlimitedLimit } from '@kernel/policies/pricing.policy';
import { useUsageStats } from '../shared/account/hooks/useUsageStats';
import { TrialOfferCardOrganism } from '../shared/upsell/TrialOfferCard.organism';
import styles from './PairingPage.module.css';

type PairingPageT = ReturnType<typeof useTranslations<'pages.pairing'>>;

export function StylistPairRequestsOrganism({ t }: { t: PairingPageT }) {
  const lang = useCurrentLang();
  const locale = useLocale();
  const tButtons = useTranslations('buttons');
  const pendingQuery = usePendingRequests(true);
  const respondMutation = useRespondPairRequest();
  const requests = pendingQuery.data?.requests ?? [];
  const { data: usage } = useUsageStats();
  // Every slot taken: „Akceptuj" would end in a bare PAIRING_LIMIT_REACHED
  // toast, so the offer sits next to the requests before she taps.
  const atClientLimit =
    usage != null &&
    !isUnlimitedLimit(usage.limits.max_paired_clients) &&
    usage.paired_clients >= usage.limits.max_paired_clients;

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

  if (requests.length === 0) {
    return null;
  }

  // Jedna mutacja obsługuje wszystkie wiersze, więc w locie blokujemy całą
  // listę, ale „trwa" (aria-busy) ogłaszamy tylko na klikniętym przycisku.
  const respondingTo = respondMutation.isPending
    ? respondMutation.variables
    : undefined;

  const handleRespond = (pair_id: string, action: 'ACCEPT' | 'DECLINE') => {
    respondMutation.mutate(
      { pair_id, action },
      {
        onSuccess: data => {
          // Lejek stałego QR: profile_view → pair_request_sent → accepted/
          // declined (PostHog; singleton respektuje opt-out wewnętrznie).
          // pair_id spina eventy lejka w jeden join (sent niesie
          // stylist_account_id — bez wspólnego id lejek per-prośba był
          // niezłączalny, review S51).
          posthog.capture(
            data.status === 'ACTIVE'
              ? 'pair_request_accepted'
              : 'pair_request_declined',
            { pair_id }
          );
          pushNewSnackbar(
            data.status === 'ACTIVE'
              ? t('requestAccepted')
              : t('requestDeclined'),
            'success'
          );
        },
        // DECISION (nie usuwaj tego komentarza): ZERO lokalnego onError-toasta.
        // useRespondPairRequest ma suppressGlobalError (warstwa 3), ale błąd
        // toastuje warstwa 1 (HTTP interceptor) — pairRequestRespond nie ustawia
        // silentBusinessError. Lokalny t('requestRespondError') = inny klucz niż
        // event interceptora → dedup nie łapie → double-toast (S51/S74). Sukces
        // zostaje lokalny, bo eventy PAIR_REQUEST_ACCEPTED/DECLINED są w
        // eventsDisallowedForUI (interceptor milczy). Kontrakt: queryClient.config.ts.
      }
    );
  };

  return (
    <div className={styles.requestsBlock}>
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
          <ul className={styles.requestsList}>
            {requests.map(request => (
              <li key={request.pair_id} className={styles.requestRow}>
                <div className={styles.requestInfo}>
                  <span className={styles.requestName}>
                    {request.name?.trim() || t('clientAnonymous')}
                  </span>
                  <span className={styles.requestDate}>
                    {formatDate(request.requested_at, locale)}
                  </span>
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
                    className='haptic-press'>
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
                    onClick={() => handleRespond(request.pair_id, 'DECLINE')}
                    className='haptic-press'>
                    {t('requestDecline')}
                  </ButtonAtom>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </CardMolecule>
      {/* Every slot taken: the offer stands next to the requests, on paper
          (it is a white box itself, so it does not go inside the box above). */}
      {atClientLimit ? <TrialOfferCardOrganism trigger='client_limit' /> : null}
    </div>
  );
}
