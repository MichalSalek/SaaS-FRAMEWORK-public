import { useId } from 'react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { CheckIcon } from '@phosphor-icons/react';
import type {
  TraitDTO,
  TraitCategory,
} from '@kernel/models/db_models.manual.dto';
import styles from './GalleryFilterOverlay.module.css';

/* ─── Constants ─── */

export const CATEGORY_ORDER: TraitCategory[] = [
  'technique',
  'finish',
  'decoration',
  'style',
];

/**
 * Filter search predicate: ONE source for the list and for the counter. The
 * overlay counts matches with it (the "no results" message) and this section
 * filters with it; two copies drift (e.g. diacritic-insensitive matching added
 * on one side) and the list contradicts the message under it.
 */
export function matchesSearchQuery(name: string, query: string): boolean {
  return name.toLowerCase().includes(query.toLowerCase().trim());
}

/* ─── Types ─── */

export interface FilterTraitSectionProps {
  traitsByCategory: Map<TraitCategory, TraitDTO[]>;
  // selectedTraits / onToggleTrait carry trait IDs (cuid), not names.
  selectedTraits: string[];
  availableTraits: TraitDTO[];
  isSearching: boolean;
  searchQuery: string;
  filteredTraitsCount: number;
  onToggleTrait: (id: string) => void;
}

/* ─── Component ─── */

export function FilterTraitSectionOrganism({
  traitsByCategory,
  selectedTraits,
  availableTraits,
  isSearching,
  searchQuery,
  filteredTraitsCount,
  onToggleTrait,
}: FilterTraitSectionProps) {
  const t = useTranslations('galleryFilter');
  const sectionLabelId = useId();
  const categoryLabelIdPrefix = useId();

  const categoryLabels: Record<TraitCategory, string> = {
    technique: t('categoryTechnique'),
    finish: t('categoryFinish'),
    decoration: t('categoryDecoration'),
    style: t('categoryStyle'),
  };

  return (
    /* DECISION: trait toggle buttons use `role="group"` + `aria-labelledby` instead of
     * <fieldset>/<legend>: fieldset is reserved for form controls (radio/checkbox), these are
     * stateful buttons. Real radios still use <fieldset> (see ReportModal). */
    <section
      role='group'
      aria-labelledby={sectionLabelId}
      className={`${styles.section} ${styles.card}`}>
      <span id={sectionLabelId} className={styles.sectionTitle}>
        {t('traitSectionTitle')}
      </span>
      {CATEGORY_ORDER.map(category => {
        const traits = traitsByCategory.get(category);
        if (!traits || traits.length === 0) {
          return null;
        }

        const filtered = isSearching
          ? traits.filter(trait => matchesSearchQuery(trait.name, searchQuery))
          : traits;

        if (filtered.length === 0) {
          return null;
        }

        const categoryLabelId = `${categoryLabelIdPrefix}-${category}`;
        return (
          <div
            key={category}
            role='group'
            aria-labelledby={categoryLabelId}
            className={`${styles.traitCategory} ${styles.filterGroup}`}>
            <span id={categoryLabelId} className={styles.categoryLabel}>
              {categoryLabels[category]}
            </span>
            <div className={styles.traitList}>
              {filtered.map(trait => {
                const isSelected = selectedTraits.includes(trait.id);
                const isAvail = availableTraits.some(av => av.id === trait.id);
                // One condition for disabling AND for muting. If they drift, a
                // control is ENABLED and muted at once: 2.61:1 text without the
                // WCAG 1.4.3 exemption (it covers INACTIVE controls only) and a
                // muted focus ring.
                const isMuted = !isAvail && !isSelected;
                // Only UNSELECTED options are disabled. The available set derives
                // from the records, so after a photo or a trait is removed a
                // selected option can fall out of it; disabled, it could not be
                // unselected (it is already gone from the quick filters) and the
                // only way out would be "Wyczyść", which clears the OTHER filters too.
                return (
                  <button
                    key={trait.id}
                    type='button'
                    className={clsx(
                      styles.traitListItem,
                      isSelected && styles.traitListItemSelected,
                      isMuted && styles.traitDimmed
                    )}
                    // The checkbox is only DRAWN (square + tick); without this
                    // attribute a screen reader announces on and off identically
                    // (SC 4.1.2). The length chip and color swatch siblings in
                    // this overlay expose their state the same way.
                    aria-pressed={isSelected}
                    disabled={isMuted || undefined}
                    onClick={
                      isAvail || isSelected
                        ? () => onToggleTrait(trait.id)
                        : undefined
                    }>
                    {isSelected && <CheckIcon size={18} aria-hidden='true' />}
                    <span>{trait.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {isSearching && filteredTraitsCount === 0 && (
        <span className={styles.noSearchResults}>
          {t('noTraitsFor', { query: searchQuery })}
        </span>
      )}
    </section>
  );
}
