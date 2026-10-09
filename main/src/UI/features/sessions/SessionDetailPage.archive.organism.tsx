// UI/features/sessions/SessionDetailPage.archive.organism.tsx
// Relationship continuity — past sessions with the same client.
//
// DECISION (nie usuwaj tego komentarza):
// Rendered ONLY when there are past sessions with this client (signals
// relationship continuity). One row per session (date + photo count) through
// the product's row primitive; the row opens that older session. Hidden
// completely on first-time clients to avoid an empty "Archiwum (0)" header.

import { useRouter } from 'next/router';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import type { SessionContainerDTO } from '@kernel/models/session-container/session-container.dto';
import { formatDate } from '../../../application/date/date.utils';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';
import type { TSessions } from './sessionTime.formatters';

export function ArchiveSectionOrganism({
  pastSessions,
  t,
}: {
  pastSessions: SessionContainerDTO[];
  t: TSessions;
}) {
  const router = useRouter();
  const locale = router.locale ?? 'pl-PL';
  if (pastSessions.length === 0) {
    return null;
  }

  return (
    <NavRowListMolecule
      label={t('inboxArchiveTitle', { count: pastSessions.length })}>
      {pastSessions.map(past => (
        <NavRowMolecule
          key={past.id}
          href={buildRoute(ROUTES_FRONT.SESSION_DETAIL, { sessionId: past.id })}
          label={formatDate(past.createdAt, locale)}
          description={t('photoCount', { count: past.photoCount })}
          trailing='disc'
        />
      ))}
    </NavRowListMolecule>
  );
}
