import { useId } from 'react';
import { useTranslations } from 'next-intl';
import type { ColorDTO, TraitDTO } from '@kernel/models/db_models.manual.dto';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import type { NailLengthOption } from './types';
import { ChipAtom, ChipGroupMolecule } from '../Chip/Chip.atom';
import { ColorSwatchMolecule } from '../ColorSwatch/ColorSwatch.molecule';
import { EyebrowAtom } from '../Eyebrow/Eyebrow.atom';
import styles from './GalleryQuickFilters.module.css';

/* ─── Types ─── */

export interface GalleryQuickFiltersProps {
  availableColors: ColorDTO[];
  availableTraits: TraitDTO[];
  availableNailLengths: readonly NailLengthOption[];
  // selected* and onToggle* carry color/trait IDs (cuid), NOT display names.
  // Explore queries the backend by color_id/trait_id; the client-side profile
  // filter also keys by id. Names are display-only (rendered inside swatch/chip).
  selectedColors: string[];
  selectedTraits: string[];
  selectedLength: string | null;
  onToggleColor: (id: string) => void;
  onToggleTrait: (id: string) => void;
  onToggleLength: (id: NailLength) => void;
}

/* ─── Component ─── */

export function GalleryQuickFiltersOrganism({
  availableColors,
  availableTraits,
  availableNailLengths,
  selectedColors,
  selectedTraits,
  selectedLength,
  onToggleColor,
  onToggleTrait,
  onToggleLength,
}: GalleryQuickFiltersProps) {
  const t = useTranslations('galleryQuickFilters');
  const colorsLabelId = useId();
  const traitsLabelId = useId();
  const lengthsLabelId = useId();

  if (
    availableColors.length === 0 &&
    availableTraits.length === 0 &&
    availableNailLengths.length === 0
  ) {
    return null;
  }

  return (
    <div className={styles.filters}>
      {/* DECISION (nie usuwaj tego komentarza):
       * Toggle button groups use `role="group"` + `aria-labelledby` rather than
       * <fieldset>/<legend>. The latter is semantically reserved for form controls
       * (radio/checkbox); these are stateful buttons. Real radios still use
       * <fieldset> (see ReportModal). */}
      {availableColors.length > 0 && (
        <div
          role='group'
          aria-labelledby={colorsLabelId}
          className={`${styles.filterSection} ${styles.filterGroup}`}>
          <span id={colorsLabelId} className={styles.filterLegend}>
            <EyebrowAtom variant='chip'>{t('colorsLabel')}</EyebrowAtom>
          </span>
          <div className={styles.colorSwatchRow}>
            {availableColors.map(color => {
              const isSelected = selectedColors.includes(color.id);
              return (
                <ColorSwatchMolecule
                  key={color.id}
                  name={color.name}
                  hex={color.hex_code}
                  size='quick'
                  selected={isSelected}
                  onClick={() => onToggleColor(color.id)}
                />
              );
            })}
          </div>
        </div>
      )}

      {availableTraits.length > 0 && (
        <div
          role='group'
          aria-labelledby={traitsLabelId}
          className={`${styles.filterSection} ${styles.filterGroup}`}>
          <span id={traitsLabelId} className={styles.filterLegend}>
            <EyebrowAtom variant='chip'>{t('traitsLabel')}</EyebrowAtom>
          </span>
          <div className={styles.scrollableChips}>
            <ChipGroupMolecule>
              {availableTraits.map(trait => {
                const isSelected = selectedTraits.includes(trait.id);
                return (
                  <ChipAtom
                    key={trait.id}
                    label={trait.name}
                    size='sm'
                    onClick={() => onToggleTrait(trait.id)}
                    aria-pressed={isSelected}
                    className={isSelected ? styles.chipSelected : styles.chip}
                  />
                );
              })}
            </ChipGroupMolecule>
          </div>
        </div>
      )}

      {availableNailLengths.length > 0 && (
        <div
          role='group'
          aria-labelledby={lengthsLabelId}
          className={`${styles.filterSection} ${styles.filterGroup}`}>
          <span id={lengthsLabelId} className={styles.filterLegend}>
            <EyebrowAtom variant='chip'>{t('lengthsLabel')}</EyebrowAtom>
          </span>
          <div className={styles.scrollableChips}>
            <ChipGroupMolecule>
              {availableNailLengths.map(len => {
                const isSelected = selectedLength === len.id;
                return (
                  <ChipAtom
                    key={len.id}
                    label={len.label}
                    size='sm'
                    onClick={() => onToggleLength(len.id)}
                    aria-pressed={isSelected}
                    className={isSelected ? styles.chipSelected : styles.chip}
                  />
                );
              })}
            </ChipGroupMolecule>
          </div>
        </div>
      )}
    </div>
  );
}
