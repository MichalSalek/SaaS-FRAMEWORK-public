import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { XIcon } from '@phosphor-icons/react';
import type {
  ColorDTO,
  TraitDTO,
  TraitCategory,
} from '@kernel/models/db_models.manual.dto';
import { AppModalShellAtom } from '../../primitives/AppModalShell.atom';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import type { NailLengthOption } from '../GalleryQuickFilters/types';
import { InputAtom } from '../Input/Input.atom';
import { ButtonAtom } from '../Button/Button.atom';
import { ErrorStateMolecule } from '../ErrorState/ErrorState.molecule';
import { useSwipeDismiss } from '../../hooks/useSwipeDismiss';
import {
  FilterTraitSectionOrganism,
  CATEGORY_ORDER,
  matchesSearchQuery,
} from './FilterTraitSection.organism';
import {
  ColorPaletteSectionOrganism,
  NailLengthSectionOrganism,
  MatchModeSectionOrganism,
} from './FilterSections.organism';
import styles from './GalleryFilterOverlay.module.css';

/* ─── Types ─── */

export interface GalleryFilterOverlayProps {
  isOpen: boolean;
  allColors: ColorDTO[];
  allTraits: TraitDTO[];
  allNailLengths: readonly NailLengthOption[];
  availableColors: ColorDTO[];
  availableTraits: TraitDTO[];
  availableNailLengths: readonly NailLengthOption[];
  // selectedColors / selectedTraits + their onToggle handlers carry color/trait
  // IDs (cuid), not display names — matches GalleryQuickFilters + Explore server
  // filter (color_id/trait_id). Names are display-only inside the sections.
  selectedColors: string[];
  selectedTraits: string[];
  selectedLength: string | null;
  exactMatch: boolean;
  matchingCount: number;
  /** The option set / count comes from a PARTIAL client-side sample (more
   *  pages exist, or the result query is still in flight). Then „not in the
   *  loaded records" does not mean „absent", so nothing is muted and a zero
   *  count is not presented as „no matches": the apply button stays live and
   *  the page keeps searching the remaining pages. Default false. */
  resultsIncomplete?: boolean;
  /** The color / trait option list failed to load and nothing is cached.
   *  Their reads are background queries (no global toast), so without this
   *  the sections rendered empty, which reads as „nothing to filter by". */
  optionsLoadFailed?: boolean;
  onRetryOptions?: () => void;
  /** A retry of the failed option list is in flight (the query's `isFetching`). */
  isRetryingOptions?: boolean;
  totalActiveFilters: number;
  onToggleColor: (id: string) => void;
  onToggleTrait: (id: string) => void;
  onToggleLength: (id: NailLength) => void;
  onExactMatchChange: (value: boolean) => void;
  onClearAll: () => void;
  onClose: () => void;
}

/* ─── Component ─── */

export function GalleryFilterOverlayOrganism({
  isOpen,
  allColors,
  allTraits,
  allNailLengths,
  availableColors,
  availableTraits,
  availableNailLengths,
  selectedColors,
  selectedTraits,
  selectedLength,
  exactMatch,
  matchingCount,
  resultsIncomplete = false,
  optionsLoadFailed = false,
  onRetryOptions,
  isRetryingOptions = false,
  totalActiveFilters,
  onToggleColor,
  onToggleTrait,
  onToggleLength,
  onExactMatchChange,
  onClearAll,
  onClose,
}: GalleryFilterOverlayProps) {
  const t = useTranslations('galleryFilter');
  const tButtons = useTranslations('buttons');
  const [searchQuery, setSearchQuery] = useState('');
  const isSearching = searchQuery.trim().length > 0;

  const traitsByCategory = (() => {
    const grouped = new Map<TraitCategory, TraitDTO[]>();
    for (const cat of CATEGORY_ORDER) {
      grouped.set(
        cat,
        allTraits.filter(t => t.category === cat)
      );
    }
    return grouped;
  })();

  const filteredTraits = !isSearching
    ? allTraits
    : allTraits.filter(t => matchesSearchQuery(t.name, searchQuery));

  const filteredColors = !isSearching
    ? allColors
    : allColors.filter(c => matchesSearchQuery(c.name, searchQuery));

  // Incomplete sample: every option stays selectable (see prop doc).
  const effectiveAvailableColors = resultsIncomplete
    ? allColors
    : availableColors;
  const effectiveAvailableTraits = resultsIncomplete
    ? allTraits
    : availableTraits;
  const effectiveAvailableNailLengths = resultsIncomplete
    ? allNailLengths
    : availableNailLengths;
  const confirmedNoMatch =
    !resultsIncomplete && totalActiveFilters > 0 && matchingCount === 0;

  const clearAll = () => {
    onClearAll();
    setSearchQuery('');
  };

  const handleClose = useCallback(() => {
    setSearchQuery('');
    onClose();
  }, [onClose]);

  // Przeciągnięcie nagłówka w dół zamyka arkusz (wspólny gest, DECISION w
  // UI/hooks/useSwipeDismiss.ts). Panel to rodzic nagłówka: AppModalShell nie
  // wystawia refa na swój panel, a nagłówek jest jego bezpośrednim dzieckiem.
  // Ten efekt MUSI stać przed hookiem — efekty biegną w kolejności deklaracji.
  const headerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    panelRef.current = headerRef.current?.parentElement ?? null;
  });
  useSwipeDismiss({
    targetRef: panelRef,
    handleRef: headerRef,
    direction: 'down',
    onDismiss: handleClose,
    enabled: isOpen,
  });

  // Focus-trap + scroll-lock + aria-modal w AppModalShell. Kept-mounted (animacja
  // wejścia/wyjścia przez overlayVisible) → active={isOpen}. 'container' = focus na
  // panel (tabIndex -1). ESC zamyka (z resetem wyszukiwania) przez handleClose.
  // portal + inert='app-root' (kanon jak PlanCheckoutDialog): panel ląduje w
  // document.body, poza animowanymi/transformowanymi przodkami stron (np.
  // .tabContent w Explore — transformowany przodek staje się containing block
  // dla position:fixed i overlay jechałby ze scrollem). Inertujemy #__next
  // zamiast chodzić w górę od panelu (panel jest siblingiem app-roota).
  return (
    <AppModalShellAtom
      variant='fullscreen'
      active={isOpen}
      onClose={handleClose}
      role='dialog'
      label={t('ariaLabel')}
      initialFocus='container'
      scrollLock
      portal
      inert='app-root'
      className={clsx(styles.overlay, isOpen && styles.overlayVisible)}>
      {/* Header.
          DECISION (nie usuwaj tego komentarza) — S126, 2026-10-09: nakładka
          to arkusz, nie ekran, więc zamyka się znakiem „X” po prawej, a nie
          przyciskiem „Wróć” (który w tej aplikacji znaczy krok w historii).
          „Wyczyść” stoi RAZ, w stopce, zawsze widoczne i wyłączone, gdy nie
          ma czego czyścić; drugie, malinowe „Wyczyść” w nagłówku zniknęło. */}
      <div ref={headerRef} className={styles.header}>
        <span className={styles.headerTitle} aria-live='polite'>
          {t('title')}
          {totalActiveFilters > 0 && (
            <span
              className={styles.headerBadge}
              aria-label={`${t('title')}: ${totalActiveFilters}`}>
              {totalActiveFilters}
            </span>
          )}
        </span>
        <ButtonAtom
          variant='ghost'
          size='sm'
          className={styles.headerClose}
          icon={<XIcon size={20} weight='regular' />}
          ariaLabel={t('close')}
          onClick={handleClose}
        />
      </div>

      {/* Body */}
      <div className={styles.body}>
        <div className={styles.searchWrapper}>
          <InputAtom
            type='search'
            // Placeholder alone is not an accessible name (it vanishes on input).
            aria-label={t('searchAriaLabel')}
            placeholder={t('searchPlaceholder')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        {optionsLoadFailed && (
          <ErrorStateMolecule
            message={t('optionsLoadError')}
            isRetrying={isRetryingOptions}
            {...(onRetryOptions !== undefined && {
              retryLabel: tButtons('retry'),
              onRetry: onRetryOptions,
            })}
          />
        )}

        <FilterTraitSectionOrganism
          traitsByCategory={traitsByCategory}
          selectedTraits={selectedTraits}
          availableTraits={effectiveAvailableTraits}
          isSearching={isSearching}
          searchQuery={searchQuery}
          filteredTraitsCount={filteredTraits.length}
          onToggleTrait={onToggleTrait}
        />

        <ColorPaletteSectionOrganism
          filteredColors={filteredColors}
          availableColors={effectiveAvailableColors}
          selectedColors={selectedColors}
          isSearching={isSearching}
          searchQuery={searchQuery}
          onToggleColor={onToggleColor}
        />

        <NailLengthSectionOrganism
          allNailLengths={allNailLengths}
          availableNailLengths={effectiveAvailableNailLengths}
          selectedLength={selectedLength}
          onToggleLength={onToggleLength}
        />

        <MatchModeSectionOrganism
          totalActiveFilters={totalActiveFilters}
          exactMatch={exactMatch}
          onExactMatchChange={onExactMatchChange}
        />
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        {confirmedNoMatch && (
          <span className={styles.filterWarning}>{t('noMatchWarning')}</span>
        )}
        <ButtonAtom
          variant='outlined'
          size='lg'
          className={styles.footerClearButton}
          onClick={clearAll}
          disabled={totalActiveFilters === 0}>
          {t('clearFilters')}
        </ButtonAtom>
        <ButtonAtom
          variant='primary'
          size='lg'
          className={clsx(
            styles.footerApplyButton,
            confirmedNoMatch && styles.footerDisabled
          )}
          onClick={handleClose}
          disabled={confirmedNoMatch}>
          {totalActiveFilters === 0
            ? t('filter')
            : resultsIncomplete
              ? t('showMatching')
              : matchingCount > 0
                ? t('showResults', { count: matchingCount })
                : t('noResults')}
        </ButtonAtom>
      </div>
    </AppModalShellAtom>
  );
}
