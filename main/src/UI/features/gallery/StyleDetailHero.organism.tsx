// UI/features/gallery/StyleDetailHero.tsx
// Editorial hero for Style Detail (W2.5 iter 1).
// Category label (gdy jest) + large name + stats pills (liczby = stan).
// Tautologiczny chip „STYL" zdjęty S88 — nazwa traitu jest nagłówkiem.
// + decorative category-specific bg pattern.

import { type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { ImagesIcon, PaletteIcon, UsersIcon } from '@phosphor-icons/react';
import type { TraitCategoryValue } from '@kernel/domain/admin/traits.config';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
import styles from './StyleDetailPage.module.css';

/* ─── Category → palette mapping ──────────────────────────
 * Deterministyczny ciepły ton per kategoria traitu, konsumowany przez
 * .hero::before (cover wash: color-mix 10% z papierem). Wszystkie hue w
 * rodzinie charcoal-gold/earth (60-120) — census S26: periwinkle/mauve
 * z pierwotnej palety dawały bladoniebieski blok czytany jako bug renderu
 * i jedyne zimne hue w apce. Rozróżnialność kategorii zostaje (4 ciepłe
 * tony), paleta brandu nienaruszona. Parametryczne OKLCH inline = celowe
 * (wartość per kategoria, nie statyczny token). */

const CATEGORY_PALETTE: Record<TraitCategoryValue, string> = {
  technique: 'oklch(0.78 0.1 85)', // gold
  finish: 'oklch(0.82 0.06 70)', // pearl beige
  decoration: 'oklch(0.76 0.11 60)', // deep amber
  style: 'oklch(0.78 0.07 115)', // olive sage
};

const FALLBACK_HUE = 'oklch(0.78 0.09 80)';

function categoryHueVars(
  category: TraitCategoryValue | undefined
): CSSProperties {
  const fromCategory =
    category !== undefined ? CATEGORY_PALETTE[category] : undefined;
  return {
    ['--style-hue']: fromCategory ?? FALLBACK_HUE,
  } as CSSProperties;
}

const PATTERN_CLASS_BY_CATEGORY: Record<TraitCategoryValue, string> = {
  technique: styles.patternTechnique ?? '',
  finish: styles.patternFinish ?? '',
  decoration: styles.patternDecoration ?? '',
  style: styles.patternStyle ?? '',
};

export function resolveCategoryKey(
  category: TraitCategoryValue | undefined
):
  | 'styleDetailCategoryTechnique'
  | 'styleDetailCategoryFinish'
  | 'styleDetailCategoryDecoration'
  | 'styleDetailCategoryStyle'
  | null {
  switch (category) {
    case 'technique':
      return 'styleDetailCategoryTechnique';
    case 'finish':
      return 'styleDetailCategoryFinish';
    case 'decoration':
      return 'styleDetailCategoryDecoration';
    case 'style':
      return 'styleDetailCategoryStyle';
    default:
      return null;
  }
}

interface StyleDetailHeroProps {
  traitName: string;
  category: TraitCategoryValue | undefined;
  totalPhotos: number;
  uniqueStylists: number;
  uniqueColors: number;
  /** Stats derive from LOADED pages only; while more pages exist they are a
   *  lower bound and render with a trailing „+" (parity with the length badges). */
  isPartial?: boolean;
}

export function StyleDetailHeroOrganism({
  traitName,
  category,
  totalPhotos,
  uniqueStylists,
  uniqueColors,
  isPartial = false,
}: StyleDetailHeroProps) {
  const t = useTranslations('pages.gallery');
  const categoryKey = resolveCategoryKey(category);
  const patternClass =
    category !== undefined
      ? PATTERN_CLASS_BY_CATEGORY[category]
      : styles.patternStyle;
  const lowerBound = isPartial ? '+' : '';

  return (
    <section
      className={`${styles.hero} ${styles.staggerIn}`}
      style={
        {
          ...categoryHueVars(category),
          '--stagger-index': 0,
        } as CSSProperties
      }>
      <div
        className={`${styles.heroPattern} ${patternClass}`}
        aria-hidden='true'
      />

      <div className={styles.heroContent}>
        {categoryKey !== null && (
          <div className={styles.heroEyebrow}>
            <EyebrowAtom variant='chip'>{t(categoryKey)}</EyebrowAtom>
          </div>
        )}

        <h1 className={styles.heroTitle}>{traitName}</h1>

        {totalPhotos > 0 && (
          <div className={styles.heroStats}>
            <span className={styles.heroStatPill}>
              <ImagesIcon
                size={13}
                weight='fill'
                className={styles.heroStatIcon}
              />
              <span className={styles.heroStatNum}>
                {totalPhotos}
                {lowerBound}
              </span>
              {t('styleDetailStatPhotos', { count: totalPhotos })}
            </span>
            {uniqueStylists > 0 && (
              <span className={styles.heroStatPill}>
                <UsersIcon
                  size={13}
                  weight='fill'
                  className={styles.heroStatIcon}
                />
                <span className={styles.heroStatNum}>
                  {uniqueStylists}
                  {lowerBound}
                </span>
                {t('styleDetailStatStylists', { count: uniqueStylists })}
              </span>
            )}
            {uniqueColors > 0 && (
              <span className={styles.heroStatPill}>
                <PaletteIcon
                  size={13}
                  weight='fill'
                  className={styles.heroStatIcon}
                />
                <span className={styles.heroStatNum}>
                  {uniqueColors}
                  {lowerBound}
                </span>
                {t('styleDetailStatColors', { count: uniqueColors })}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
