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
 * Predykat wyszukiwarki filtrów — JEDNO źródło dla listy i dla licznika.
 * Overlay liczył nim „ile pasuje" (komunikat „brak wyników"), a ta sekcja
 * filtrowała drugą, niezależną kopią tego samego wyrażenia. Rozjazd któregokolwiek
 * z nich — choćby dopisanie dopasowania bez znaków diakrytycznych po jednej
 * stronie — dawałby listę mówiącą co innego niż komunikat pod nią.
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
    /* DECISION (nie usuwaj tego komentarza):
     * Trait toggle buttons use `role="group"` + `aria-labelledby` instead of
     * <fieldset>/<legend>. The semantic <fieldset> is reserved for form controls
     * (radio/checkbox); these are stateful buttons. Real radios still use
     * <fieldset> (see ReportModal). */
    <section
      role='group'
      aria-labelledby={sectionLabelId}
      className={`${styles.section} ${styles.filterGroup}`}>
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
                // Jeden warunek na wylaczenie I na wygaszenie. Rozjazd miedzy
                // nimi produkuje kontrolke WLACZONA i wygaszona naraz, czyli
                // tekst 2,61:1 bez zwolnienia WCAG 1.4.3 (zwolnienie dotyczy
                // kontrolek NIEAKTYWNYCH) i wygaszony pierscien fokusu.
                const isMuted = !isAvail && !isSelected;
                // Wylaczamy tylko opcje NIEWYBRANE. Zbior dostepnych derywuje
                // z rekordow, wiec po usunieciu zdjecia albo zdjeciu cechy przy
                // edycji zaznaczona opcja potrafi wypasc z dostepnych; gdyby
                // wtedy dostala `disabled`, nie dalaby sie odznaczyc, a z rzedu
                // szybkich filtrow juz znikla — jedynym wyjsciem zostaloby
                // "Wyczysc", kasujace RESZTE filtrow razem z nia.
                return (
                  <button
                    key={trait.id}
                    type='button'
                    className={clsx(
                      styles.traitListItem,
                      isSelected && styles.traitListItemSelected,
                      isMuted && styles.traitDimmed
                    )}
                    // Checkbox jest tu RYSOWANY (kwadrat + ptaszek), ale bez
                    // tego atrybutu czytnik oglaszal filtr wlaczony i wylaczony
                    // identycznie (SC 4.1.2). Rodzenstwo w tym samym overlayu —
                    // chip dlugosci i swatch koloru — stan wystawia od dawna.
                    aria-pressed={isSelected}
                    disabled={isMuted || undefined}
                    onClick={
                      isAvail || isSelected
                        ? () => onToggleTrait(trait.id)
                        : undefined
                    }>
                    <span
                      className={clsx(
                        styles.traitCheckbox,
                        isSelected && styles.traitCheckboxActive
                      )}>
                      {isSelected && <CheckIcon size={14} />}
                    </span>
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
