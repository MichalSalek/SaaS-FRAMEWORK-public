import { useTranslations } from 'next-intl';
import type { SessionContainerDetailDTO } from '@kernel/models/session-container/session-container.dto';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { StatusPillAtom } from '../../components/StatusPill/StatusPill.atom';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import {
  formatAbsoluteDate,
  getLifecycleColor,
  getLifecycleLabel,
  sessionTimestamp,
  shouldPulseStatus,
} from './ClientSessionsPage.formatters';
import { SessionAcceptanceStatusMolecule } from './SessionAcceptanceStatus.molecule';
import { SessionExpiryMolecule } from './components/SessionExpiry.molecule';
import styles from './ClientSessionDetailPage.module.css';

export function ClientSessionHeroMolecule({
  session,
  isShared,
  isTerminal,
}: {
  session: SessionContainerDetailDTO;
  isShared: boolean;
  isTerminal: boolean;
}) {
  const t = useTranslations('pages.sessions');
  const lang = useCurrentLang();
  return (
    <>
      {/* The hero carries the SESSION (name, state, dates); the credit row
          carries the RECIPIENT. A named session shows its name, otherwise the
          generic „Sesja inspiracji”. The facts are ONE meta member with a gap
          between them, so no separator glyph is drawn. */}
      <AppHeroOrganism
        title={session.name ?? t('sessionTitle')}
        meta={
          <span data-breakable=''>
            <span className={styles.heroFacts}>
              <StatusPillAtom
                color={getLifecycleColor(session.lifecycleState)}
                label={getLifecycleLabel(session.lifecycleState, t)}
                pulse={shouldPulseStatus(session.lifecycleState)}
              />
              <SessionAcceptanceStatusMolecule
                acceptedAt={session.accepted_at}
                changedAt={session.last_client_change_at}
                viewedAt={session.viewed_at}
              />
              {/* A finished session carries the date its row in the list
                  carries (one fact, one date); „created” next to „closed”
                  read as the date of closing. */}
              <span className={styles.heroFact}>
                {isTerminal
                  ? formatAbsoluteDate(sessionTimestamp(session), lang)
                  : t('detailDateCreated', {
                      date: formatAbsoluteDate(session.createdAt, lang),
                    })}
              </span>
              {isShared && session.expiresAt !== null && (
                <span className={styles.heroNote}>
                  <SessionExpiryMolecule expiresAt={session.expiresAt} />
                </span>
              )}
            </span>
          </span>
        }
      />
    </>
  );
}
