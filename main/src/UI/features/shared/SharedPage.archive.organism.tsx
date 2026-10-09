// UI/features/shared/SharedPage.archive.organism.tsx
// Finished sessions (closed or expired), grouped by month: each month is one
// list of rows under its own header. The row itself comes from
// ./SharedPage.parts.organism.tsx.

import { useMemo } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import type { SessionContainerDTO } from '@kernel/models/session-container/session-container.dto';
import { NavRowListMolecule } from '../../components/NavRow/NavRow.molecule';
import { formatGroupLabel, getArchiveGroupKey } from './shared.helpers';
import { SharedSessionRowOrganism } from './SharedPage.parts.organism';
import styles from './SharedPage.module.css';

export function SharedArchiveSectionOrganism({
  sessions,
}: {
  sessions: SessionContainerDTO[];
}) {
  const t = useTranslations('pages.shared');
  const locale = useRouter().locale ?? 'pl-PL';

  // Group by year-month, newest month first.
  const grouped = useMemo(() => {
    const map = new Map<string, SessionContainerDTO[]>();
    for (const s of sessions) {
      const key = getArchiveGroupKey(s);
      const list = map.get(key);
      if (list) {
        list.push(s);
      } else {
        map.set(key, [s]);
      }
    }
    return Array.from(map.entries()).sort(([a], [b]) => (a > b ? -1 : 1));
  }, [sessions]);

  return (
    <section className={styles.section}>
      {/* No count here: the hero already says how many are archived. */}
      <h2 className={styles.sectionTitle}>{t('archiveSectionTitle')}</h2>
      {grouped.map(([groupKey, groupSessions]) => {
        const monthLabel = formatGroupLabel(groupKey, locale);
        return (
          <div key={groupKey} className={styles.month}>
            <div className={styles.monthHeader}>
              <h3 className={styles.monthLabel}>{monthLabel}</h3>
              <span className={styles.monthCount}>
                {t('monthCount', { count: groupSessions.length })}
              </span>
            </div>
            <NavRowListMolecule ariaLabel={monthLabel}>
              {groupSessions.map(session => (
                <SharedSessionRowOrganism
                  key={session.id}
                  session={session}
                  locale={locale}
                />
              ))}
            </NavRowListMolecule>
          </div>
        );
      })}
    </section>
  );
}
