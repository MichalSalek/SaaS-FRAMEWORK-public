// UI/features/client-card/ClientCardPage.history.organism.tsx
// Historia wizyt klientki: lista (cursor-paginated, 30/stronę, „Pokaż starsze")
// i stany loading/error/empty. Dodawanie wizyty to główna akcja ekranu i stoi
// nad notatką (ManualVisitComposerMolecule w kompozycji), nie pod listą.

import { useTranslations } from 'next-intl';
import type { VisitRecordDTO } from '@kernel/models/visit/visit.dto';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { SectionHeader } from './ClientCardPage.parts.organism';
import {
  EmptyHistory,
  VisitCardMolecule,
  VisitSkeletons,
} from './ClientCardPage.visit-card.molecule';
import { isUnlimitedLimit } from '@kernel/policies/pricing.policy';
import styles from './ClientCardPage.module.css';

export function HistorySectionOrganism({
  visits,
  clientUserId,
  isLoading,
  isError,
  hasData,
  isLoadMoreError,
  hasMore,
  isLoadingMore,
  onLoadMore,
  retentionDays,
  onUpdateNote,
  onRemovePhoto,
  onDeleteVisit,
  onRetry,
  isRetrying = false,
}: {
  visits: VisitRecordDTO[];
  clientUserId: string;
  isLoading: boolean;
  isError: boolean;
  /** Visits were fetched at least once; with isError = stale list. */
  hasData: boolean;
  /** The failed request was „show older visits", not the whole list. */
  isLoadMoreError: boolean;
  /** Cursor-paginated (30 per page): older visits exist beyond the loaded ones. */
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  /** null = jeszcze nieznane (wizyty w locie) — meta nie ma pokazywać „0 dni". */
  retentionDays: number | null;
  onUpdateNote: (visitId: string, note: string) => Promise<unknown>;
  onRemovePhoto: (visitId: string, photoId: string) => Promise<unknown>;
  onDeleteVisit: (visitId: string) => Promise<unknown>;
  onRetry: () => void;
  /** A retry (full refetch or "show older") is in flight — the two error
   *  slabs below never render at once, so one flag covers both. */
  isRetrying?: boolean;
}) {
  const t = useTranslations('clientCard');
  const tButtons = useTranslations('buttons');
  // Full error only when no list was ever loaded. A failed refresh or a failed
  // „show older" keeps the loaded visits (TQ v5 keeps `data`); the old gate
  // on bare isError swapped the whole history for an error slab and lost the
  // scroll position of a stylist who had just paged back through it.
  // An EMPTY cached history under an error is unconfirmed: full error with
  // retry, never the "no visits yet" empty state.
  const historyKnown = hasData && !(isError && visits.length === 0);
  const showFullError = isError && !historyKnown;
  const hasVisits = !isLoading && historyKnown && visits.length > 0;

  return (
    <section className={styles.block}>
      {/* Kontekst pod tytułem tylko gdy są wpisy: pusty stan niesie tę samą
       * informację we własnym copy. */}
      <SectionHeader
        title={t('historyTitle')}
        {...(hasVisits ? { meta: t('autoSessionHint') } : {})}
      />
      {isLoading && <VisitSkeletons />}
      {showFullError && (
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={tButtons('retry')}
          onRetry={onRetry}
          isRetrying={isRetrying}
        />
      )}
      {!isLoading && historyKnown && visits.length === 0 && <EmptyHistory />}
      {hasVisits && (
        <div className={styles.visitList}>
          {visits.map(visit => (
            <VisitCardMolecule
              key={visit.id}
              visit={visit}
              clientUserId={clientUserId}
              onUpdateNote={onUpdateNote}
              onRemovePhoto={onRemovePhoto}
              onDeleteVisit={onDeleteVisit}
            />
          ))}
        </div>
      )}
      {historyKnown && isError && (
        <ErrorStateMolecule
          message={
            isLoadMoreError ? t('loadMoreVisitsError') : t('historyStaleError')
          }
          retryLabel={tButtons('retry')}
          onRetry={isLoadMoreError ? onLoadMore : onRetry}
          isRetrying={isLoadMoreError ? isLoadingMore : isRetrying}
        />
      )}
      {hasVisits && hasMore && !isLoadMoreError && (
        <ButtonAtom
          variant='outlined'
          size='sm'
          className={styles.loadMoreBtn}
          onClick={onLoadMore}
          disabled={isLoadingMore}>
          {isLoadingMore ? t('loadingMoreVisits') : t('loadMoreVisits')}
        </ButtonAtom>
      )}
      {/* How far back the plan reaches: said where the list ENDS, which is
       * where the question „why is there nothing older” comes up. */}
      {hasVisits && !hasMore && retentionDays !== null && (
        <p className={styles.historyReach}>
          {isUnlimitedLimit(retentionDays)
            ? t('fullHistoryHint')
            : t('retentionHint', { days: retentionDays })}
        </p>
      )}
    </section>
  );
}
