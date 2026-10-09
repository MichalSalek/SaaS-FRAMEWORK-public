// UI/features/sessions/ClientSessionsPage.blocks.organism.tsx
// Section-level blocks of the client's session list: open sessions, history
// by month, the empty state and the loading skeleton. The row itself lives
// in ./ClientSessionsPage.parts.organism.tsx.

import { CalendarBlankIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import type { SessionContainerDTO } from '@kernel/models/session-container/session-container.dto';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import {
  NavRowListMolecule,
  NavRowListSkeletonMolecule,
} from '../../components/NavRow/NavRow.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import {
  SessionRowOrganism,
  SessionMonthGroupOrganism,
} from './ClientSessionsPage.parts.organism';
import { sessionTimestamp } from './ClientSessionsPage.formatters';
import styles from './ClientSessionsPage.module.css';

type TSessionsPage = ReturnType<typeof useTranslations<'pages.sessions'>>;

/* ============================================================
 * ActiveSessionsBlock — open sessions (the page sorts drafts first)
 * ============================================================ */

export function ActiveSessionsBlockOrganism({
  sessions,
  locale,
  t,
  disambiguationTimes,
  stylistNames,
}: {
  sessions: SessionContainerDTO[];
  locale: string;
  t: TSessionsPage;
  disambiguationTimes: ReadonlyMap<string, string>;
  /** Connected stylists by account id: names the stylist of each session. */
  stylistNames: ReadonlyMap<string, string>;
}) {
  return (
    <section className={styles.section}>
      {/* No count here: the hero already says how many are open. */}
      <h2 className={styles.sectionTitle}>{t('activeSectionTitle')}</h2>
      <NavRowListMolecule ariaLabel={t('activeSectionTitle')}>
        {sessions.map(session => (
          <SessionRowOrganism
            key={session.id}
            session={session}
            locale={locale}
            t={t}
            disambiguationTime={disambiguationTimes.get(session.id)}
            stylistName={
              session.stylistAccountId !== null
                ? stylistNames.get(session.stylistAccountId)
                : undefined
            }
          />
        ))}
      </NavRowListMolecule>
    </section>
  );
}

/* ============================================================
 * TimelineSection — heading + month groups of finished sessions
 * ============================================================ */

export function TimelineSectionOrganism({
  monthGroups,
  locale,
  t,
  disambiguationTimes,
  stylistNames,
}: {
  monthGroups: ReadonlyArray<readonly [string, SessionContainerDTO[]]>;
  locale: string;
  t: TSessionsPage;
  disambiguationTimes: ReadonlyMap<string, string>;
  stylistNames: ReadonlyMap<string, string>;
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{t('timelineSectionTitle')}</h2>
      {monthGroups.map(([key, monthSessions]) => {
        const first = monthSessions[0];
        if (first === undefined) {
          return null;
        }
        return (
          <SessionMonthGroupOrganism
            key={key}
            monthIso={sessionTimestamp(first)}
            sessions={monthSessions}
            locale={locale}
            t={t}
            disambiguationTimes={disambiguationTimes}
            stylistNames={stylistNames}
          />
        );
      })}
    </section>
  );
}

/* ============================================================
 * SessionsEmptyState — what a session is, the one action, then the steps
 *
 * The three steps sit UNDER the action (they used to stand between the
 * sentence and the button and pushed it below the fold). They are a plain
 * list: nothing in it is tappable, so it wears no icons, orbs or connectors.
 * There is no drawing for this screen in LP_ASSETS.empty yet, hence the icon.
 * ============================================================ */

export function SessionsEmptyStateOrganism({
  onCreateClick,
}: {
  onCreateClick: () => void;
}) {
  const t = useTranslations('pages.sessions');
  const lang = useCurrentLang();
  const steps = [
    { title: t('step1Title'), hint: t('step1Hint') },
    { title: t('step2Title'), hint: t('step2Hint') },
    { title: t('emptyStep3Title'), hint: t('step3Hint') },
  ];

  return (
    <>
      <EmptyStateAtom
        size='page'
        icon={<CalendarBlankIcon size={44} weight='duotone' />}
        title={t('emptyTitle')}
        titleAs='h2'
        description={t('onboardingSubtitle')}
        lang={lang}
        action={
          <ButtonAtom variant='primary' size='lg' onClick={onCreateClick}>
            {t('createFirstSession')}
          </ButtonAtom>
        }
      />
      <section className={`${styles.section} ${styles.howItWorks}`}>
        <h2 className={styles.sectionTitle}>{t('howItWorksTitle')}</h2>
        <ol className={styles.steps}>
          {steps.map(step => (
            <li key={step.title} className={styles.step}>
              <span className={styles.stepTitle}>{step.title}</span>
              <span className={styles.stepHint} lang={lang}>
                {step.hint}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

/* ============================================================
 * SessionsListSkeleton — the create button and three rows, final boxes
 * ============================================================ */

export function SessionsListSkeletonOrganism() {
  return (
    <>
      <SkeletonAtom
        variant='rect'
        height={48}
        className={styles.primaryActionSkeleton}
      />
      <NavRowListSkeletonMolecule lines={3} />
    </>
  );
}
