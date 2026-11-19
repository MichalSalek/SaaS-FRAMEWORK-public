// UI/features/dashboard/components/StylistDashboardAside.organism.tsx
// The READING column of the stylist dashboard: her numbers, the link to share, her public „O mnie”
// text and the role zone. Under the main column on a phone, beside it from 720px of the page's own
// width (PageColumnsMolecule).

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { OutcomeStateMolecule } from '../../../components/OutcomeFeedback/OutcomeState.molecule';
import type { useDashboardFeed } from '../../shared/dashboard/hooks/useDashboardFeed';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import {
  StatTileBandMolecule,
  StatTileMolecule,
} from '../../../components/StatTile/StatTile.molecule';
import { formatMonthYear } from '../../../../application/date/date.utils';
import { ProfileShareCardOrganism } from '../../shared/profile/ProfileShareCard.organism';
import { PublicBioCardOrganism } from './PublicBioCard.organism';
import { SessionInsightsCardOrganism } from './SessionInsightsCard.organism';
import styles from './StylistDashboard.module.css';
import pageStyles from '../DashboardPage.module.css';

type DashboardFeed = ReturnType<typeof useDashboardFeed>['feed'];

/** „lipca 2026” for „Od {date} w Nailfolio”, or undefined when unparsable.
 * DECISION: pass the locale explicitly from useLocale(): undefined causes a hydration mismatch
 * (Node SSR 'en' vs CSR 'pl'). formatMonthYear gives the pl genitive ("czerwca 2026") that the
 * phrase "Od {date}" requires. */
function formatMemberSince(raw: unknown, locale: string): string | undefined {
  if (raw === null || raw === undefined || raw === '') {
    return undefined;
  }
  const date = new Date(raw as string | Date);
  return Number.isNaN(date.getTime())
    ? undefined
    : formatMonthYear(date, locale);
}

export function StylistDashboardAsideOrganism({
  feed,
  strengthDone,
  onDismissStrength,
  roleZone,
}: {
  feed: DashboardFeed;
  /** Gallery strength reached 100% and the stylist has not closed the note. */
  strengthDone: boolean;
  onDismissStrength: () => void;
  roleZone: ReactNode;
}) {
  const locale = useLocale();
  const t = useTranslations('dashboard.stylist');
  const memberSince = formatMemberSince(feed?.member_since, locale);
  // DASH-8 (beta-honest): numbers stay hidden until the first photo, so a
  // brand-new stylist never reads a wall of zeros.
  const hasPhotos = (feed?.photo_count ?? 0) > 0;

  return (
    <>
      {hasPhotos && (
        <section className={pageStyles.section} data-app-section='plain'>
          <h2 className={pageStyles.sectionTitle} data-app-section-title=''>
            {t('portfolioStats.title')}
          </h2>
          {/* Read-only tiles, not rows with icons and dividers (those read as a tappable list). Works
                        and clients are NOT repeated here: the line under the greeting already states them. */}
          <StatTileBandMolecule ariaLabel={t('portfolioStats.title')}>
            <StatTileMolecule
              label={t('portfolioStats.likes')}
              value={(feed?.like_count ?? 0).toLocaleString(locale)}
            />
            <StatTileMolecule
              label={t('portfolioStats.profileViews')}
              // No „~” before the number (user-eyes review): a
              // reader could not tell what the mark meant. The count is what
              // the backend holds after de-duplicating repeat views.
              value={(feed?.profile_view_count ?? 0).toLocaleString(locale)}
            />
          </StatTileBandMolecule>
          {memberSince !== undefined && (
            <p className={pageStyles.quietLine}>
              {t('portfolioStats.memberSince', { date: memberSince })}
            </p>
          )}
        </section>
      )}

      {/* A finished state takes one line, not a card on the fold (owner). The control that removes it
                says so in a word: readers of the user-eyes review could not tell what a bare cross would do
                to this line. */}
      {strengthDone && (
        <div className={styles.doneLine}>
          <OutcomeStateMolecule
            confirmed
            message={t('strengthDone')}
            className={styles.doneText}
          />
          <ButtonAtom variant='text' size='sm' onClick={onDismissStrength}>
            {t('strengthDoneHide')}
          </ButtonAtom>
        </div>
      )}

      <SessionInsightsCardOrganism />

      {/* Profile Hub — share own public profile (viral loop, audit 1C).
          Outlined: the filled action of this screen is the stage action. */}
      <ProfileShareCardOrganism ctaVariant='outlined' />

      {/* The public „O mnie” text sits right under the share card, where she
          looks for it; her private notes live on /app/notes (owner). */}
      <PublicBioCardOrganism />

      {roleZone}
    </>
  );
}
