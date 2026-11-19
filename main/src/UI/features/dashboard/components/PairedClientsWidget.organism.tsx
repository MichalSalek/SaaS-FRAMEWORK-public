// PairedClientsWidget: the stylist dashboard's connected-clients module.
// Split out of StylistDashboard.parts (300-line limit).

import { AppLinkAtom as Link } from '../../../components/AppLink/AppLink.atom';
import type { ReactNode } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../../application/routing/buildRoute';
import { EmptyStateAtom } from '../../../components/EmptyState/EmptyState.atom';
import { IllustrationAtom } from '../../../components/Illustration/Illustration.atom';
import { LP_ASSETS } from '../../../assets/lpAssets';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { AvatarAtom } from '../../../components/Avatar/Avatar.atom';
import { SkeletonAtom } from '../../../components/Skeleton/Skeleton.atom';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import type { PairsResponse } from '../../shared/pairing/hooks/usePairedList';
import { AffordanceDiscAtom } from '../../../components/AffordanceDisc/AffordanceDisc.atom';
import { LinkButtonAtom } from '../../../components/Button/LinkButton.atom';
import {
  attentionPairIds,
  orderPairsByAttention,
  type ClientAttention,
} from '../../shared/pairing/clientAttention.logic';
import styles from './StylistDashboard.module.css';
import pageStyles from '../DashboardPage.module.css';

/** Faces shown before the closing „Wszystkie” tile (DECISION below). */
const STRIP_MAX = 12;

/* --- PairedClientsWidget --- */

export function PairedClientsWidgetOrganism({
  pairs,
  isLoading,
  loadFailed,
  moreFailed,
  onRetry,
  isRetrying = false,
  onRetryMore,
  isRetryingMore = false,
  totalKnown,
  attention,
  emptyActionVariant,
}: {
  pairs: PairsResponse['pairs'];
  isLoading: boolean;
  /** Nothing to show and the query failed (first page never arrived, or a
   *  refetch failed over an empty list): the list is UNKNOWN, not empty. */
  loadFailed: boolean;
  /** A later page failed: the rows shown are real but the list is incomplete. */
  moreFailed: boolean;
  onRetry: () => void;
  /** The full-list retry (onRetry) is in flight. */
  isRetrying?: boolean;
  onRetryMore: () => void;
  /** The "load more" retry (onRetryMore) is in flight. */
  isRetryingMore?: boolean;
  /** Every page has arrived: only then may the tile print the total. */
  totalKnown: boolean;
  /** Dot sources per face (useClientAttention): unread messages per pair id
   *  and clients with a waiting session. EMPTY while a source loads or
   *  fails: then no face carries a dot from it. */
  attention: ClientAttention;
  /** `'primary'` when „show your code” is the screen's main action. */
  emptyActionVariant: 'primary' | 'outlined';
}) {
  const router = useRouter();
  const t = useTranslations('dashboard.stylist');
  const tPairing = useTranslations('pages.pairing');
  const tLabels = useTranslations('labels');
  const tButtons = useTranslations('buttons');

  const attentionIds = attentionPairIds(pairs, attention);

  // Before the empty-state branch on purpose: a failed fetch must never read
  // as "no clients yet" (the empty state invites pairing a first client).
  const renderBody = (): ReactNode => {
    if (loadFailed) {
      return (
        <ErrorStateMolecule
          message={t('pairsLoadError')}
          retryLabel={tButtons('retry')}
          onRetry={onRetry}
          isRetrying={isRetrying}
        />
      );
    }

    if (isLoading) {
      return (
        <div className={styles.clientStrip} aria-hidden='true'>
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={styles.clientStripItem}>
              <SkeletonAtom variant='circle' width={40} height={40} />
              <SkeletonAtom variant='text' width={48} />
            </div>
          ))}
        </div>
      );
    }

    if (pairs.length === 0) {
      // On paper with the shared empty state. The action used to be an outlined button inside a
      // white card, where it read as bare text.
      return (
        <EmptyStateAtom
          className={styles.emptyPairs}
          illustration={
            <IllustrationAtom
              src={LP_ASSETS.empty.connectionsWidget}
              size='sm'
            />
          }
          title={t('emptyPairs.body')}
          titleAs='h3'
          description={t('emptyPairs.caption')}
          action={
            <ButtonAtom
              variant={emptyActionVariant}
              size='md'
              direction='forward'
              className='press-feedback'
              onClick={() => void router.push(ROUTES_FRONT.PAIRING)}>
              {t('emptyPairs.cta')}
            </ButtonAtom>
          }
        />
      );
    }

    // DECISION: the dashboard shows connected clients as ONE horizontally scrolling row of faces
    // with a closing "Wszystkie" tile into the full list (/app/clients). The row keeps a constant
    // height at any client count (the old list was 595px at 8 clients, several screens at 50) and
    // the connection date left the dashboard on purpose; it lives on the full list. Capped at the
    // newest STRIP_MAX connections (the API orders by paired_at desc) so the closing tile stays
    // reachable: behind 50 faces nobody finds it. Active clients first (stable, so newest stays
    // first within each group): inactive, non-tappable faces must not take the capped slots. A
    // client who needs the stylist's attention carries a dot on her face and moves to the FRONT of
    // the strip, so a dot is never hidden behind the scroll or the cap (ordering + tests:
    // clientAttention.logic in features/shared/pairing, shared with the full list). Attention =
    // unread messages from her, or a shared inspiration session still waiting. (owner)
    const visiblePairs = orderPairsByAttention(pairs, attentionIds, STRIP_MAX);
    const capped = pairs.length > STRIP_MAX;
    return (
      <>
        <ul className={styles.clientStrip} aria-label={t('pairsStripLabel')}>
          {visiblePairs.map(pair => {
            const pairId = 'user_id' in pair ? pair.user_id : pair.account_id;
            if (pair.counterpart_inactive) {
              const inactiveLabel = tPairing('inactiveAccount');
              return (
                <li key={pairId} className={styles.clientStripItem}>
                  <AvatarAtom name={inactiveLabel} size='md' />
                  <span className={styles.clientStripName}>
                    {inactiveLabel}
                  </span>
                </li>
              );
            }
            // The stylist shape carries the name in `name` (User), the client's in `display_name`
            // (StylistAccount) — without reading `name` the row fell back to the raw e-mail despite a
            // known client name.
            const displayName =
              'display_name' in pair
                ? pair.display_name
                : 'name' in pair
                  ? pair.name
                  : null;
            // DECISION: a client without a name is "Klientka" here, as on the "Twoje klientki"
            // list, NOT her login address. The connection request promises her that the stylist
            // will see the name and contact data entered in her profile; the address she logs in
            // with is not part of them.
            const label = displayName?.trim() || tLabels('clientFallback');
            const clientUserId = 'user_id' in pair ? pair.user_id : null;
            if (clientUserId === null) {
              return null;
            }
            const unread = attention.unreadByPair.get(pair.id) ?? 0;
            const pendingSession =
              attention.pendingSessionClients.has(clientUserId);
            const status = [
              ...(unread > 0 ? [t('pairsStripUnread', { count: unread })] : []),
              ...(pendingSession ? [t('pairsStripSession')] : []),
            ];
            return (
              <li key={pairId} className={styles.clientStripItem}>
                <Link
                  href={buildRoute(ROUTES_FRONT.CLIENT_CARD, {
                    id: clientUserId,
                  })}
                  aria-label={[label, ...status].join(', ')}
                  className={styles.clientStripLink}>
                  <span className={styles.clientStripFace}>
                    <AvatarAtom name={label} size='md' decorative />
                    {status.length > 0 && (
                      <span
                        className={styles.clientStripDot}
                        aria-hidden='true'
                      />
                    )}
                  </span>
                  <span className={styles.clientStripName} aria-hidden='true'>
                    {firstWord(label)}
                  </span>
                </Link>
              </li>
            );
          })}
          <li className={styles.clientStripItem}>
            <Link
              href={ROUTES_FRONT.CLIENTS}
              className={styles.clientStripLink}>
              <AffordanceDiscAtom />
              {/* The count is one unbreakable piece on its own line: inside
                  the 84px tile „Wszystkie (50)” was cut with an ellipsis. */}
              <span className={styles.clientStripAll}>
                <span>{t('pairsStripAll')}</span>
                {capped && totalKnown && (
                  <span className={styles.clientStripAllCount}>
                    ({pairs.length})
                  </span>
                )}
              </span>
            </Link>
          </li>
        </ul>
        {/* usePairedList stops its eager page walk on a failed page (no retry
          loop), so without this the row would silently stay truncated. */}
        {moreFailed && (
          <ErrorStateMolecule
            message={t('pairsLoadMoreError')}
            retryLabel={tButtons('retry')}
            onRetry={onRetryMore}
            isRetrying={isRetryingMore}
          />
        )}
      </>
    );
  };

  return (
    <section className={pageStyles.section} data-app-section='plain'>
      {/* The door to the full list stands in the header as well: at the end of the strip it is
                off-screen at first (five of six first-contact readers could not see „Wszystkie”). The
                closing tile of the strip stays (owner vote). */}
      <div className={pageStyles.sectionHead}>
        <h2 className={pageStyles.sectionTitle} data-app-section-title=''>
          {t('pairedClientsLoading')}
        </h2>
        {pairs.length > 0 && (
          <LinkButtonAtom
            variant='text'
            size='sm'
            direction='forward'
            href={ROUTES_FRONT.CLIENTS}>
            {t('pairsStripAll')}
          </LinkButtonAtom>
        )}
      </div>
      {/* DECISION: the dot on a face is stated in WORDS here (it had no meaning on screen); no
          legend. The line is always mounted with its height reserved: the dot sources answer
          after the list, and the strip must not move. */}
      <p className={pageStyles.sectionMeta} aria-live='polite'>
        {attentionIds.size > 0
          ? t('clientsAttention', { count: attentionIds.size })
          : null}
      </p>
      {renderBody()}
    </section>
  );
}

/** First name for the face tile; the full name is the link's accessible name. */
function firstWord(label: string): string {
  return label.split(/\s+/)[0] ?? label;
}
