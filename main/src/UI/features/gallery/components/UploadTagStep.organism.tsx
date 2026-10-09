// UI/features/gallery/components/UploadTagStep.tsx
// Step 2 of the upload wizard: sectioned tag form (colors, traits, length)
// with eyebrow headers and counter pills per section. Extracted from
// UploadAssetPage.parts to respect the 300 LOC ceiling.

import {
  CheckIcon,
  CaretLeftIcon,
  PaletteIcon,
  TagIcon,
  RulerIcon,
} from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import type { ColorDTO, TraitDTO } from '@kernel/models/db_models.manual.dto';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import {
  ChipAtom,
  ChipGroupMolecule,
} from '../../../components/Chip/Chip.atom';
import {
  ColorSwatchMolecule,
  ColorSwatchGridOrganism,
} from '../../../components/ColorSwatch/ColorSwatch.molecule';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { TagOptionsLoadStateMolecule } from './TagOptionsLoadState.molecule';
import { isSelectionFull } from '../hooks/tagSelection';
import { UploadTagSectionHeaderMolecule } from './UploadTagSectionHeader.molecule';
import styles from '../UploadAssetPage.module.css';

interface NailLengthOption {
  id: NailLength;
  label: string;
}

/** Powiązanie aria-describedby: wyłączone „Dalej" wskazuje na widoczny powód. */
const BLOCKED_REASON_ID = 'upload-step2-blocked-reason';

/** Load status of one option list (the hooks return `[]` in every non-data state). */
export interface TagOptionsStatus {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** A retry is in flight (the backing query's `isFetching`). */
  isRetrying?: boolean;
}

interface UploadTagStepProps {
  colors: ColorDTO[];
  traits: TraitDTO[];
  colorsStatus: TagOptionsStatus;
  traitsStatus: TagOptionsStatus;
  selectedColorIds: string[];
  selectedTraitIds: string[];
  selectedLength: NailLength | null;
  nailLengthOptions: readonly NailLengthOption[];
  maxColors: number;
  onToggleColor: (id: string) => void;
  onToggleTrait: (id: string) => void;
  onSelectLength: (len: NailLength) => void;
  onBack: () => void;
  onNext: () => void;
  canProceed: boolean;
  /** Czytelny powód wyłączonego „Dalej" (null = nic nie brakuje). */
  blockedReason: string | null;
}

export function UploadTagStepOrganism({
  colors,
  traits,
  colorsStatus,
  traitsStatus,
  selectedColorIds,
  selectedTraitIds,
  selectedLength,
  nailLengthOptions,
  maxColors,
  onToggleColor,
  onToggleTrait,
  onSelectLength,
  onBack,
  onNext,
  canProceed,
  blockedReason,
}: UploadTagStepProps) {
  const t = useTranslations('pages.gallery');
  // Przy komplecie kolorów niewybrane próbki są REALNIE nieaktywne: czwarte
  // kliknięcie było wcześniej cichym no-opem (reducer zwracał ten sam stan),
  // które wyglądało jak zepsuty przycisk. Wybrane zostają klikalne, żeby dało
  // się zwolnić miejsce.
  const colorsFull = isSelectionFull(selectedColorIds, maxColors);
  return (
    /* Listwa akcji jest RODZEŃSTWEM treści kroku, nie jej dzieckiem — powód
       w DECISION przy .stickyActionBar (UploadAssetPage.module.css). */
    <>
      <div
        className={`${styles.stepContent} ${styles.stepContentEnter}`}
        style={{ '--stagger-index': 4 } as React.CSSProperties}>
        <div className={styles.stepHeader}>
          <TypographyAtom variant='h3' className={styles.stepHeaderTitle}>
            {t('uploadTagTitle')}
          </TypographyAtom>
          <TypographyAtom variant='body2' className={styles.stepHeaderSubtitle}>
            {t('uploadTagSubtitle')}
          </TypographyAtom>
        </div>

        <section className={styles.tagSection}>
          <UploadTagSectionHeaderMolecule
            icon={<PaletteIcon size={14} weight='fill' />}
            title={t('uploadColorsLabel')}
            hint={t('uploadColorsHint', { max: maxColors })}
            counter={{
              label: t('uploadColorsCounter', {
                count: selectedColorIds.length,
                max: maxColors,
              }),
              filled: selectedColorIds.length > 0,
            }}
          />
          <TagOptionsLoadStateMolecule
            hasOptions={colors.length > 0}
            isLoading={colorsStatus.isLoading}
            isError={colorsStatus.isError}
            errorMessage={t('uploadColorsLoadError')}
            retryLabel={t('retry')}
            onRetry={colorsStatus.onRetry}
            isRetrying={colorsStatus.isRetrying ?? false}>
            <ColorSwatchGridOrganism className={styles.colorGrid}>
              {colors.map(c => {
                const isSelected = selectedColorIds.includes(c.id);
                return (
                  <ColorSwatchMolecule
                    key={c.id}
                    name={c.name}
                    hex={c.hex_code}
                    size='lg'
                    selected={isSelected}
                    disabled={colorsFull && !isSelected}
                    onClick={() => onToggleColor(c.id)}
                  />
                );
              })}
            </ColorSwatchGridOrganism>
          </TagOptionsLoadStateMolecule>
        </section>

        <section className={styles.tagSection}>
          <UploadTagSectionHeaderMolecule
            icon={<TagIcon size={14} weight='fill' />}
            title={t('uploadTraitsLabel')}
            hint={t('uploadTraitsHint')}
            counter={{
              label: t('uploadTraitsCounter', {
                count: selectedTraitIds.length,
              }),
              filled: selectedTraitIds.length > 0,
            }}
          />
          <TagOptionsLoadStateMolecule
            hasOptions={traits.length > 0}
            isLoading={traitsStatus.isLoading}
            isError={traitsStatus.isError}
            errorMessage={t('uploadTraitsLoadError')}
            retryLabel={t('retry')}
            onRetry={traitsStatus.onRetry}
            isRetrying={traitsStatus.isRetrying ?? false}>
            <ChipGroupMolecule>
              {traits.map(traitItem => (
                <ChipAtom
                  key={traitItem.id}
                  label={traitItem.name}
                  size='sm'
                  onClick={() => onToggleTrait(traitItem.id)}
                  selected={selectedTraitIds.includes(traitItem.id)}
                />
              ))}
            </ChipGroupMolecule>
          </TagOptionsLoadStateMolecule>
        </section>

        <section className={styles.tagSection}>
          <UploadTagSectionHeaderMolecule
            icon={<RulerIcon size={14} weight='fill' />}
            title={t('uploadNailLengthLabel')}
            hint={t('uploadNailLengthHint')}
          />
          <div className={styles.lengthGrid}>
            {nailLengthOptions.map(len => (
              <button
                key={len.id}
                type='button'
                aria-pressed={selectedLength === len.id}
                className={`${styles.lengthCard} ${selectedLength === len.id ? styles.lengthCardSelected : ''}`}
                onClick={() => onSelectLength(len.id)}>
                <TypographyAtom
                  variant='body2'
                  className={styles.lengthCardLabel}>
                  {len.label}
                </TypographyAtom>
                {/* Zawsze zamontowany i wyjęty z przepływu: znak montowany
                    dopiero po wyborze rozpychał kartę i jej sąsiadów. */}
                <CheckIcon
                  size={14}
                  weight='bold'
                  className={styles.lengthCheck}
                  aria-hidden='true'
                />
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* Listwa akcji: powód wyłączonego CTA stoi PRZY przycisku i jedzie
          razem z nim (przyklejona listwa), a nie w treści, którą można
          przewinąć poza ekran. */}
      <div className={styles.stickyActionBar}>
        {blockedReason !== null && (
          <TypographyAtom
            id={BLOCKED_REASON_ID}
            variant='caption'
            className={styles.stickyActionBarReason}>
            {blockedReason}
          </TypographyAtom>
        )}
        <ButtonAtom
          variant='outlined'
          size='md'
          icon={<CaretLeftIcon size={16} />}
          onClick={onBack}>
          {t('uploadBack')}
        </ButtonAtom>
        <ButtonAtom
          direction='forward'
          variant='primary'
          size='md'
          onClick={onNext}
          disabled={!canProceed}
          aria-describedby={
            blockedReason !== null ? BLOCKED_REASON_ID : undefined
          }
          className={`${styles.stickyPrimaryCta} haptic-press`}>
          {t('uploadNext')}
        </ButtonAtom>
      </div>
    </>
  );
}
