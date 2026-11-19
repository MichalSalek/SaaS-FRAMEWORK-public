import { Fragment } from 'react';
import { useTranslations } from 'next-intl';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import styles from './StylistProfilePage.module.css';

interface ProfileStatsProps {
  bookmarkCount: number;
  totalLikes: number;
  galleryCount: number;
  viewCount: number;
}

interface StatEntry {
  key: string;
  value: number;
  label: string;
  // live counter (view_count); see the DECISION at the render
  live?: boolean;
}

// DECISION: engagement stats show only above a threshold, because a low number („1 polubienie
// profilu”) is negative proof for a new stylist; do not remove the gate. „prace” has no
// threshold (see the empty-profile rule below). JSON-LD interactionStatistic keeps every
// counter regardless. scripts/dev/preflight.sh parses this constant's shape (owner).
const STAT_MIN_TO_SHOW = { bookmarks: 3, likes: 5, views: 20 } as const;

export function StylistProfileStatsMolecule({
  bookmarkCount,
  totalLikes,
  galleryCount,
  viewCount,
}: ProfileStatsProps) {
  const t = useTranslations('stylist.stats');

  // DECISION: bookmarkCount (likes of the stylist herself, JSON-LD BookmarkAction) and
  // totalLikes (likes of her works, LikeAction) are two counters with scoped labels
  // „polubień profilu” / „polubień prac”. Do not merge them or shorten both to „polubienia”:
  // two adjacent identical labels (owner).
  // DECISION: an empty profile shows no counter („0 prac” looked like a glitch); works join
  // the band from the first work, and the band renders only with TWO or more numbers, since a
  // lone number is the same narrow box and the gallery heading carries the work count
  // (owner).
  const stats: StatEntry[] = [];
  if (galleryCount > 0) {
    stats.push({
      key: 'works',
      value: galleryCount,
      label: t('works', { count: galleryCount }),
    });
  }
  if (bookmarkCount >= STAT_MIN_TO_SHOW.bookmarks) {
    stats.push({
      key: 'bookmarks',
      value: bookmarkCount,
      label: t('bookmarks', { count: bookmarkCount }),
    });
  }
  if (totalLikes >= STAT_MIN_TO_SHOW.likes) {
    stats.push({
      key: 'likes',
      value: totalLikes,
      label: t('likes', { count: totalLikes }),
    });
  }
  if (viewCount >= STAT_MIN_TO_SHOW.views) {
    stats.push({
      key: 'views',
      value: viewCount,
      label: t('views', { count: viewCount }),
      live: true,
    });
  }

  if (stats.length < 2) {
    return null;
  }

  return (
    <section className={styles.statsRow} aria-label={t('ariaLabel')}>
      {stats.map((stat, i) => (
        <Fragment key={stat.key}>
          {i > 0 && <div className={styles.statDivider} aria-hidden='true' />}
          <div className={styles.statItem}>
            {/* DECISION: view_count is a live counter incremented on every visit, so SSR
             * and hydration can differ; suppressHydrationWarning on the `live` value and
             * label tolerates that without a tree rebuild. A mounted gate is worse (CLS). */}
            <TypographyAtom
              variant='subtitle'
              className={styles.statValue}
              suppressHydrationWarning={stat.live}>
              {stat.value}
            </TypographyAtom>
            <TypographyAtom
              variant='caption'
              className={styles.statLabel}
              suppressHydrationWarning={stat.live}>
              {stat.label}
            </TypographyAtom>
          </div>
        </Fragment>
      ))}
    </section>
  );
}
