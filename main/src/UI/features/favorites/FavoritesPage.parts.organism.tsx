// UI/features/favorites/FavoritesPage.parts.organism.tsx
// States of the favorites panel: the two empty states and the loading
// skeleton. (Failure is the shared ErrorStateMolecule, rendered by the page.)
//
// NOTE: StylesTab / StylistsTab are NOT re-exported here on purpose: they
// import the empty states FROM this file, so re-exporting them back would be
// an import cycle.

import { useTranslations } from 'next-intl';
import { CompassIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { IllustrationAtom } from '../../components/Illustration/Illustration.atom';
import { LP_ASSETS } from '../../assets/lpAssets';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { NavRowListSkeletonMolecule } from '../../components/NavRow/NavRow.molecule';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import { usePublicFeatureFlag } from '../../../application/feature-flags/client-feature-flags';
import type { FavoritesTab } from './favoritesUrl.helpers';
import styles from './FavoritesPage.module.css';

/* DECISION (nie usuwaj tego komentarza) — S126: an empty state ALWAYS offers
 * the one next step. Liking happens on photos and profiles, and the place to
 * find them depends on EXPLORE_ENABLED (kernel default OFF, runtime-reactive):
 * with Explore on, the step is Explore; with Explore parked (its route 404s),
 * the step is the client's own stylists, whose galleries she can open today.
 * Before S126 the parked case rendered no action at all: a dead end. */
function EmptyNextStep({ exploreLabel }: { exploreLabel: string }) {
  const t = useTranslations('pages.favorites');
  const exploreEnabled = usePublicFeatureFlag(
    FEATURE_FLAG_KEYS.EXPLORE_ENABLED
  );
  return exploreEnabled ? (
    <LinkButtonAtom
      href={ROUTES_FRONT.EXPLORE}
      variant='primary'
      size='md'
      icon={<CompassIcon size={18} />}>
      {exploreLabel}
    </LinkButtonAtom>
  ) : (
    <LinkButtonAtom
      href={ROUTES_FRONT.PAIRING}
      variant='primary'
      size='md'
      direction='forward'>
      {t('emptyCtaYourStylists')}
    </LinkButtonAtom>
  );
}

export function FavoritesStylesEmptyOrganism() {
  const t = useTranslations('pages.favorites');
  const lang = useCurrentLang();
  return (
    <EmptyStateAtom
      size='page'
      role='status'
      illustration={
        <IllustrationAtom src={LP_ASSETS.empty.emptyFavorites} size='lg' />
      }
      title={t('stylesEditorialEmptyTitle')}
      titleAs='h2'
      description={t('stylesEditorialEmptyHint')}
      lang={lang}
      action={<EmptyNextStep exploreLabel={t('stylesEditorialEmptyCta')} />}
    />
  );
}

export function FavoritesStylistsEmptyOrganism() {
  const t = useTranslations('pages.favorites');
  const lang = useCurrentLang();
  return (
    <EmptyStateAtom
      size='page'
      role='status'
      icon={<UsersThreeIcon size={44} />}
      title={t('stylistsEditorialEmptyTitle')}
      titleAs='h2'
      description={t('stylistsEditorialEmptyHint')}
      lang={lang}
      action={<EmptyNextStep exploreLabel={t('stylistsEditorialEmptyCta')} />}
    />
  );
}

/** Loading stand-in with the geometry of what follows: photo tiles for
 *  „Stylizacje”, person rows for „Stylistki”. */
export function FavoritesPanelSkeletonMolecule({ tab }: { tab: FavoritesTab }) {
  if (tab === 'stylists') {
    return <NavRowListSkeletonMolecule leading lines={2} />;
  }
  return (
    <div className={styles.galleryGrid} aria-hidden='true'>
      {[0, 1, 2, 3].map(i => (
        <SkeletonAtom key={i} variant='rect' width='100%' height={300} />
      ))}
    </div>
  );
}
