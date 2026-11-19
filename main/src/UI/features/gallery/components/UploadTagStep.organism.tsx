// UI/features/gallery/components/UploadTagStep.tsx
// Step 2 of the upload wizard: sectioned tag form (colors, traits, length)
// with eyebrow headers and counter pills per section. Extracted from
// UploadAssetPage.parts to respect the 300 LOC ceiling.

import { useState } from 'react';
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
import { CompletionLineMolecule } from '../../../components/OutcomeFeedback/CompletionLine.molecule';

interface NailLengthOption {
  id: NailLength;
  label: string;
}

/** aria-describedby target: the disabled „Dalej" points to the visible reason. */
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
  /** Readable reason „Dalej" is disabled (null = nothing is missing). */
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
  const [showErrors, setShowErrors] = useState(false);
  const statusMessage = blockedReason ?? t('uploadTagsComplete');
  const colorsMissing = selectedColorIds.length === 0;
  const traitsMissing = selectedTraitIds.length === 0;
  const lengthMissing = selectedLength === null;

  // DECISION: the primary button is not `disabled`, because a disabled control
  // cannot explain itself. A tap on an incomplete form marks the missing
  // sections, scrolls to the first one and focuses its first control; the
  // action still does nothing until the set is complete. (owner)
  const revealFirstMissing = () => {
    setShowErrors(true);
    const sectionId = colorsMissing
      ? 'upload-colors-section'
      : traitsMissing
        ? 'upload-traits-section'
        : 'upload-length-section';
    const section = document.getElementById(sectionId);
    section?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    section
      ?.querySelector<HTMLElement>('button:not([disabled])')
      ?.focus({ preventScroll: true });
  };
  // With a full set of colours the unselected swatches are REALLY inactive: a
  // fourth click would be a silent no-op (the reducer returns the same state)
  // that looks like a broken button. Selected ones stay clickable so a slot can
  // be freed.
  const colorsFull = isSelectionFull(selectedColorIds, maxColors);
  return (
    /* The action bar is a SIBLING of the step content, not its child; see the
       DECISION at .stickyActionBar (UploadAssetPage.module.css). */
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

        <section
          id='upload-colors-section'
          className={styles.tagSection}
          data-invalid={showErrors && colorsMissing ? 'true' : undefined}>
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
          {showErrors && colorsMissing && (
            <p className={styles.tagSectionError} role='alert'>
              {t('uploadColorsRequired')}
            </p>
          )}
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

        <section
          id='upload-traits-section'
          className={styles.tagSection}
          data-invalid={showErrors && traitsMissing ? 'true' : undefined}>
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
          {showErrors && traitsMissing && (
            <p className={styles.tagSectionError} role='alert'>
              {t('uploadTraitsRequired')}
            </p>
          )}
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

        <section
          id='upload-length-section'
          className={styles.tagSection}
          data-invalid={showErrors && lengthMissing ? 'true' : undefined}>
          <UploadTagSectionHeaderMolecule
            icon={<RulerIcon size={14} weight='fill' />}
            title={t('uploadNailLengthLabel')}
            hint={t('uploadNailLengthHint')}
          />
          {showErrors && lengthMissing && (
            <p className={styles.tagSectionError} role='alert'>
              {t('uploadLengthRequired')}
            </p>
          )}
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
                {/* Always mounted and out of flow: a mark mounted only after
                    selection would push the card and its neighbours. */}
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

      {/* Action bar: the reason the CTA is disabled stands NEXT to the button
          and travels with it (sticky bar), not in content that can scroll
          off screen. */}
      <div className={styles.stickyActionBar}>
        <CompletionLineMolecule
          id={BLOCKED_REASON_ID}
          state={canProceed ? 'complete' : 'blocked'}
          message={statusMessage}
          reserveMessage={t('uploadNextBlocked', {
            missing: [
              t('uploadNextBlockedColors'),
              t('uploadNextBlockedTraits'),
              t('uploadNextBlockedLength'),
            ].join(', '),
          })}
          className={styles.stickyActionBarReason}
        />
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
          onClick={() => {
            if (canProceed) {
              onNext();
              return;
            }
            revealFirstMissing();
          }}
          aria-disabled={!canProceed}
          aria-describedby={
            blockedReason !== null ? BLOCKED_REASON_ID : undefined
          }
          className={`${styles.stickyPrimaryCta} press-feedback`}>
          {t('uploadNext')}
        </ButtonAtom>
      </div>
    </>
  );
}
