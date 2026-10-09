import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import type { ColorDTO } from '@kernel/models/db_models.manual.dto';
import {
  ColorSwatchMolecule,
  ColorSwatchGridOrganism,
} from '../ColorSwatch/ColorSwatch.molecule';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import type { NailLengthOption } from '../GalleryQuickFilters/types';
import styles from './GalleryFilterOverlay.module.css';

/* ─── Color Palette Section ─── */

export function ColorPaletteSectionOrganism({
  filteredColors,
  availableColors,
  selectedColors,
  isSearching,
  searchQuery,
  onToggleColor,
}: {
  filteredColors: ColorDTO[];
  availableColors: ColorDTO[];
  selectedColors: string[];
  isSearching: boolean;
  searchQuery: string;
  // selectedColors / onToggleColor carry color IDs (cuid), not names.
  onToggleColor: (id: string) => void;
}) {
  const t = useTranslations('galleryFilter');
  return (
    <fieldset className={`${styles.section} ${styles.filterGroup}`}>
      <legend className={styles.sectionTitle}>{t('colorPaletteLabel')}</legend>
      {isSearching && filteredColors.length === 0 ? (
        <span className={styles.noSearchResults}>
          {t('noColorsFor', { query: searchQuery })}
        </span>
      ) : (
        <ColorSwatchGridOrganism>
          {filteredColors.map(color => {
            const isAvail = availableColors.some(c => c.id === color.id);
            const isSelected = selectedColors.includes(color.id);
            // Wylaczamy tylko kolory NIEWYBRANE — wybrany, ktory wypadl
            // z dostepnych (usuniete zdjecie, zdjeta cecha), musi dac sie
            // odznaczyc, inaczej zostaje pulapka do wyjscia wylacznie przez
            // "Wyczysc". Wygaszenie idzie TYM SAMYM warunkiem: wygaszony
            // element wlaczony to tekst 2,61:1 bez zwolnienia WCAG.
            const isMuted = !isAvail && !isSelected;
            return (
              <div
                key={color.id}
                className={isMuted ? styles.traitDimmed : undefined}>
                <ColorSwatchMolecule
                  name={color.name}
                  hex={color.hex_code}
                  size='lg'
                  selected={isSelected}
                  disabled={isMuted}
                  onClick={() => onToggleColor(color.id)}
                />
              </div>
            );
          })}
        </ColorSwatchGridOrganism>
      )}
    </fieldset>
  );
}

/* ─── Nail Length Section ─── */

export function NailLengthSectionOrganism({
  allNailLengths,
  availableNailLengths,
  selectedLength,
  onToggleLength,
}: {
  allNailLengths: readonly NailLengthOption[];
  availableNailLengths: readonly NailLengthOption[];
  selectedLength: string | null;
  onToggleLength: (id: NailLength) => void;
}) {
  const t = useTranslations('galleryFilter');
  return (
    <fieldset className={`${styles.section} ${styles.filterGroup}`}>
      <legend className={styles.sectionTitle}>{t('nailLengthLabel')}</legend>
      <div className={styles.lengthChips}>
        {allNailLengths.map(len => {
          const isSelected = selectedLength === len.id;
          const isAvail = availableNailLengths.some(l => l.id === len.id);
          // a11y: render as <button> with aria-pressed so AT announces toggle state.
          return (
            <button
              key={len.id}
              type='button'
              onClick={
                isAvail || isSelected ? () => onToggleLength(len.id) : undefined
              }
              disabled={(!isAvail && !isSelected) || undefined}
              aria-pressed={isSelected}
              className={
                isSelected
                  ? styles.lengthChipSelected
                  : isAvail
                    ? styles.lengthChip
                    : clsx(styles.lengthChip, styles.traitDimmed)
              }>
              {len.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/* ─── Match Mode Section ─── */

export function MatchModeSectionOrganism({
  totalActiveFilters,
  exactMatch,
  onExactMatchChange,
}: {
  totalActiveFilters: number;
  exactMatch: boolean;
  onExactMatchChange: (value: boolean) => void;
}) {
  const t = useTranslations('galleryFilter');
  if (totalActiveFilters < 2) {
    return null;
  }

  return (
    <fieldset className={`${styles.matchModeSection} ${styles.filterGroup}`}>
      <legend className={styles.sectionTitle}>{t('matchModeLabel')}</legend>
      <label className={styles.radioOption} htmlFor='matchMode-any'>
        <input
          id='matchMode-any'
          type='radio'
          name='matchMode'
          checked={!exactMatch}
          onChange={() => onExactMatchChange(false)}
          className={styles.radioInput}
        />
        <span className={styles.radioLabel}>{t('matchAny')}</span>
        <span className={styles.radioDescription}>{t('matchAnyDesc')}</span>
      </label>
      <label className={styles.radioOption} htmlFor='matchMode-all'>
        <input
          id='matchMode-all'
          type='radio'
          name='matchMode'
          checked={exactMatch}
          onChange={() => onExactMatchChange(true)}
          className={styles.radioInput}
        />
        <span className={styles.radioLabel}>{t('matchAll')}</span>
        <span className={styles.radioDescription}>{t('matchAllDesc')}</span>
      </label>
    </fieldset>
  );
}
