/**
 * ExploreStylistsTab — parts: Toolbar, EmptyState, Skeleton.
 * Karta-intro = kanon <AppHero> (S25/1 wariant D), renderowana bezpośrednio
 * w ExploreStylistsTab.tsx. Extracted from ExploreStylistsTab.tsx to keep
 * parent under file-size limit. StylistCard lives in its own file.
 */

import { useTranslations } from 'next-intl';
import { MapPinIcon, ArrowRightIcon, CompassIcon } from '@phosphor-icons/react';
import { InputAtom } from '../../../components/Input/Input.atom';
import { useCurrentLang } from '../../../hooks/useCurrentLang';
import { EmptyStateAtom } from '../../../components/EmptyState/EmptyState.atom';
import styles from './ExploreStylistsTab.module.css';

export { StylistCardOrganism } from './StylistCard.organism';

/* ─── Toolbar (search + city pill rail) ──────────────────────── */

export interface StylistsToolbarProps {
  cities: readonly string[];
  selectedCity: string;
  searchInput: string;
  onCityChange: (city: string) => void;
  onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  resultCount: number;
}

export function StylistsToolbarMolecule({
  cities,
  selectedCity,
  searchInput,
  onCityChange,
  onSearchChange,
  resultCount,
}: StylistsToolbarProps) {
  const t = useTranslations('pages.explore');
  return (
    <div
      className={`${styles.toolbar} ${styles.staggerIn}`}
      style={{ '--stagger-index': 1 } as React.CSSProperties}>
      <div className={styles.searchWrap}>
        <InputAtom
          type='search'
          aria-label={t('searchStylistAriaLabel')}
          placeholder={t('searchStylistPlaceholder')}
          value={searchInput}
          onChange={onSearchChange}
        />
      </div>
      <div
        className={styles.cityRail}
        role='tablist'
        aria-label={t('stylistsFilterLabel')}>
        {cities.map(city => {
          const isActive = selectedCity === city;
          const label =
            city === 'Wszystkie'
              ? t('citiesAll')
              : city === 'Inne'
                ? t('citiesOther')
                : city;
          return (
            <button
              key={city}
              type='button'
              role='tab'
              aria-selected={isActive}
              className={`${styles.cityPill} ${
                isActive ? styles.cityPillActive : ''
              } haptic-press`}
              onClick={() => onCityChange(city)}>
              {city === 'Wszystkie' && (
                <CompassIcon
                  size={13}
                  weight={isActive ? 'fill' : 'regular'}
                  className={styles.cityPillIcon}
                  aria-hidden='true'
                />
              )}
              {city !== 'Wszystkie' && city !== 'Inne' && (
                <MapPinIcon
                  size={13}
                  weight={isActive ? 'fill' : 'regular'}
                  className={styles.cityPillIcon}
                  aria-hidden='true'
                />
              )}
              {label}
            </button>
          );
        })}
      </div>
      {resultCount > 0 && (
        <div className={styles.resultBar}>
          <span className={styles.resultCount}>
            {t('stylistCount', { count: resultCount })}
          </span>
        </div>
      )}
    </div>
  );
}

/* ─── Empty State (branded illustration + actionable CTA) ────── */

export interface StylistsEmptyStateProps {
  onClear: () => void;
}

export function StylistsEmptyStateOrganism({
  onClear,
}: StylistsEmptyStateProps) {
  const t = useTranslations('pages.explore');
  const lang = useCurrentLang();
  return (
    <EmptyStateAtom
      className={`${styles.emptyState} ${styles.staggerIn}`}
      style={{ '--stagger-index': 2 } as React.CSSProperties}
      icon={<CompassIcon size={32} weight='duotone' />}
      title={t('stylistsEmptyTitle')}
      description={t('stylistsEmptyHint')}
      lang={lang}
      action={
        <button
          type='button'
          className={`${styles.cardCta} haptic-press`}
          onClick={onClear}>
          {t('stylistsEmptyCta')}
          <ArrowRightIcon
            size={14}
            weight='bold'
            className={styles.cardCtaIcon}
          />
        </button>
      }
    />
  );
}

/* ─── Skeleton (shimmer pulse cards) ─────────────────────────── */

export function StylistsTabSkeletonMolecule() {
  return (
    <div className={styles.skeletonList} aria-hidden='true'>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className={styles.skeletonCard}>
          <div className={styles.skeletonCover} />
          <div className={styles.skeletonBody}>
            <div className={styles.skeletonAvatar} />
            <div
              className={`${styles.skeletonLine} ${styles.skeletonLineLg}`}
            />
            <div
              className={`${styles.skeletonLine} ${styles.skeletonLineSm}`}
            />
            <div className={styles.skeletonThumbRow}>
              <div className={styles.skeletonThumb} />
              <div className={styles.skeletonThumb} />
              <div className={styles.skeletonThumb} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
