// UI/features/client-card/ClientCardPage.expired-sessions.molecule.tsx
// The client's shared sessions that ran out of time before anyone closed them,
// folded below the visit history. Each row opens the session (photos and her
// note stay readable to the stylist).
//
// DECISION: an expired session is not a visit (nothing confirms the visit took place, and the
// client would see it among her visits), so it stands apart from the history and starts folded:
// it must not mix with the closed sessions and the manual visits. (owner)

import { useLocale, useTranslations } from 'next-intl';
import type { ExpiredSessionSummaryDTO } from '@kernel/models/visit/visit.dto';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import { formatDateLong } from '../../../application/date/date.utils';
import { keepShortWordsWithNext } from '../../shared/typography/short-words';
import { DisclosureMolecule } from '../../components/Disclosure/Disclosure.molecule';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';
import styles from './ClientCardPage.module.css';

export function ExpiredSessionsMolecule({
  sessions,
}: {
  sessions: ExpiredSessionSummaryDTO[];
}) {
  const t = useTranslations('clientCard');
  const locale = useLocale();
  if (sessions.length === 0) {
    return null;
  }
  return (
    <DisclosureMolecule
      title={t('expiredSessions.title')}
      summary={t('expiredSessions.summary', { count: sessions.length })}>
      <p className={styles.expiredHint}>
        {keepShortWordsWithNext(t('expiredSessions.hint'))}
      </p>
      <div className={styles.expiredList}>
        <NavRowListMolecule ariaLabel={t('expiredSessions.title')}>
          {sessions.map(session => (
            <NavRowMolecule
              key={session.id}
              href={buildRoute(ROUTES_FRONT.SESSION_DETAIL, {
                sessionId: session.id,
              })}
              label={session.name ?? t('expiredSessions.fallbackName')}
              // A number never breaks from its word („13 sierpnia”, „3 zdjęcia”).
              description={t('expiredSessions.rowDescription', {
                date: formatDateLong(session.expiresAt, locale),
                count: session.photoCount,
              }).replace(/(\d) /g, '$1\u00a0')}
              trailing='disc'
            />
          ))}
        </NavRowListMolecule>
      </div>
    </DisclosureMolecule>
  );
}
