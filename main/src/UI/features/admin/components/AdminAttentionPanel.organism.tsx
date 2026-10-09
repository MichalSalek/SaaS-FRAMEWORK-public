// admin/components/AdminAttentionPanel.organism.tsx
// Dashboard panel „Wymaga reakcji”: every admin counter as one row that says
// what is counted and opens exactly the counted items.
//
// DECISION (nie usuwaj tego komentarza) — owner 2026-10-08: the menu showed
// „Dashboard 1” and the dashboard showed no 1 anywhere. The total on the
// dashboard's menu badge is now the sum of THESE rows, so the number in the
// menu and the list on the page are the same thing. Queues with nothing
// waiting fold into one quiet line: a row of seven zeros would bury the one
// row that needs a hand. Rows and copy come from admin-attention.config.ts,
// the same source the menu badges read.

import { useTranslations } from 'next-intl';
import { AppLinkAtom } from '../../../components/AppLink/AppLink.atom';
import { AffordanceDiscAtom } from '../../../components/AffordanceDisc/AffordanceDisc.atom';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import { SkeletonAtom } from '../../../components/Skeleton/Skeleton.atom';
import { useAdminAttentionCounts } from '../hooks/useAdminAttentionCounts';
import {
  ADMIN_ATTENTION_COPY_VALUES,
  ADMIN_ATTENTION_ORDER,
  ADMIN_ATTENTION_SIGNALS,
  sumAttention,
} from '../admin-attention.config';
import styles from './AdminAttentionPanel.module.css';

const HEADING_ID = 'admin-attention-heading';
const SKELETON_ROWS = 3;

export function AdminAttentionPanelOrganism() {
  const t = useTranslations('admin.attention');
  const { counts, isError, isFetching, refetch } =
    useAdminAttentionCounts(true);

  const waiting = ADMIN_ATTENTION_ORDER.filter(key => (counts?.[key] ?? 0) > 0);
  const quiet = ADMIN_ATTENTION_ORDER.filter(key => (counts?.[key] ?? 0) === 0);
  const total = sumAttention(counts, ADMIN_ATTENTION_ORDER);

  return (
    <section className={styles.panel} aria-labelledby={HEADING_ID}>
      <header className={styles.header}>
        <h2 id={HEADING_ID} className={styles.title}>
          {t('title')}
        </h2>
        {counts !== null && total > 0 && (
          <span className={styles.total}>{t('total', { count: total })}</span>
        )}
      </header>

      {counts === null ? (
        isError ? (
          <ErrorStateMolecule
            message={t('loadError')}
            retryLabel={t('retry')}
            onRetry={() => void refetch()}
            isRetrying={isFetching}
          />
        ) : (
          <ul className={styles.list} aria-hidden='true'>
            {Array.from({ length: SKELETON_ROWS }, (_, index) => (
              <li key={index} className={styles.item}>
                <span className={styles.row}>
                  <SkeletonAtom variant='text' width={96} height={18} />
                  <SkeletonAtom variant='text' width={220} height={18} />
                </span>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          {waiting.length === 0 ? (
            <p className={styles.allClear}>{t('allClear')}</p>
          ) : (
            <ul className={styles.list}>
              {waiting.map(key => {
                const signal = ADMIN_ATTENTION_SIGNALS[key];
                return (
                  <li key={key} className={styles.item}>
                    <AppLinkAtom href={signal.href} className={styles.row}>
                      <span className={styles.label}>{t(signal.labelKey)}</span>
                      <span className={styles.count}>
                        {t(signal.countLabelKey, {
                          ...ADMIN_ATTENTION_COPY_VALUES,
                          count: counts[key],
                        })}
                      </span>
                      <AffordanceDiscAtom size='sm' />
                    </AppLinkAtom>
                  </li>
                );
              })}
            </ul>
          )}
          {waiting.length > 0 && quiet.length > 0 && (
            <p className={styles.quiet}>
              {t('unchanged', {
                list: quiet
                  .map(key => t(ADMIN_ATTENTION_SIGNALS[key].labelKey))
                  .join(', '),
              })}
            </p>
          )}
        </>
      )}
    </section>
  );
}
