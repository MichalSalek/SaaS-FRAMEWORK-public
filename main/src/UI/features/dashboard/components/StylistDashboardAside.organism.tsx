// UI/features/dashboard/components/StylistDashboardAside.organism.tsx
// The READING column of the stylist dashboard (S126): her numbers, the link
// to share, her notes and the role zone. Under the main column on a phone,
// beside it from 720px of the page's own width (PageColumnsMolecule).

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { XIcon } from '@phosphor-icons/react';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import type { useDashboardFeed } from '../../shared/dashboard/hooks/useDashboardFeed';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import {
  StatTileBandMolecule,
  StatTileMolecule,
} from '../../../components/StatTile/StatTile.molecule';
import { formatMonthYear } from '../../../../application/date/date.utils';
import { ProfileShareCardOrganism } from '../../shared/profile/ProfileShareCard.organism';
import { DashboardNoteOrganism } from './DashboardNote.organism';
import styles from './StylistDashboard.module.css';
import pageStyles from '../DashboardPage.module.css';

type DashboardFeed = ReturnType<typeof useDashboardFeed>['feed'];

/** „lipca 2026” for „Od {date} w Nailfolio”, or undefined when unparsable.
 *  DECISION (nie usuwaj — S18-mirror): locale jawny z useLocale() — undefined
 *  prowadzi do hydration mismatch (Node SSR 'en' vs CSR 'pl'). formatMonthYear
 *  daje dopełniacz pl ("czerwca 2026") wymagany przez frazę "Od {date}". */
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
  const tStrength = useTranslations('galleryStrength');
  const memberSince = formatMemberSince(feed?.member_since, locale);
  // DASH-8 (beta-honest): numbers stay hidden until the first photo, so a
  // brand-new stylist never reads a wall of zeros.
  const hasPhotos = (feed?.photo_count ?? 0) > 0;

  return (
    <>
      {hasPhotos && (
        <section className={pageStyles.section}>
          <h2 className={pageStyles.sectionTitle}>
            {t('portfolioStats.title')}
          </h2>
          {/* S126: read-only tiles, not rows with icons and dividers (those
              read as a tappable list). Works and clients are NOT repeated
              here: the line under the greeting already states them. */}
          <StatTileBandMolecule ariaLabel={t('portfolioStats.title')}>
            <StatTileMolecule
              label={t('portfolioStats.likes')}
              value={(feed?.like_count ?? 0).toLocaleString(locale)}
            />
            <StatTileMolecule
              label={t('portfolioStats.profileViews')}
              // No „~” before the number (user-eyes review 2026-10-09): a
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

      {/* A finished state takes one line, not a card on the fold (owner
          2026-10-08). The close button keeps the function the card had. */}
      {strengthDone && (
        <div className={styles.doneLine}>
          <span className={styles.doneText}>{t('strengthDone')}</span>
          <ButtonAtom
            variant='ghost'
            size='sm'
            icon={<XIcon size={18} />}
            ariaLabel={tStrength('dismiss')}
            onClick={onDismissStrength}
          />
        </div>
      )}

      {/* Profile Hub — share own public profile (viral loop, audit 1C).
          Outlined: the filled action of this screen is the stage action. */}
      <ProfileShareCardOrganism ctaVariant='outlined' />

      <DashboardNoteOrganism accountType={AccountTypeValue.STYLIST} />

      {roleZone}
    </>
  );
}
