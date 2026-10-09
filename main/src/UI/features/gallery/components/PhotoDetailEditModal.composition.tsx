// UI/features/gallery/components/PhotoDetailEditModal.tsx
// Edit modal for PhotoDetailPage — color/trait/nail-length editor.

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  FloppyDiskIcon,
  XIcon,
  PaletteIcon,
  TagIcon,
  RulerIcon,
} from '@phosphor-icons/react';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import {
  ChipAtom,
  ChipGroupMolecule,
} from '../../../components/Chip/Chip.atom';
import {
  ColorSwatchMolecule,
  ColorSwatchGridOrganism,
} from '../../../components/ColorSwatch/ColorSwatch.molecule';
import { AppDialogAtom } from '../../../primitives/AppDialog.atom';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { useUpdateGalleryRecord } from '../hooks/useUpdateGalleryRecord';
import { useGalleryColors } from '../../shared/gallery/hooks/useGalleryColors';
import { useGalleryTraits } from '../../shared/gallery/hooks/useGalleryTraits';
import { useNailLengthOptions } from '../../shared/gallery/nailLengthOptions.config';
import { MAX_COLORS } from '../hooks/useUploadAssetState';
import { TagOptionsLoadStateMolecule } from './TagOptionsLoadState.molecule';
import {
  isSelectionFull,
  toggleCappedSelection,
  toggleSelection,
} from '../hooks/tagSelection';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import editStyles from '../PhotoDetailEditModal.module.css';

interface PhotoDetailEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photoId: string;
  initialColorIds: string[];
  initialTraitIds: string[];
  initialNailLength: NailLength | null;
}

export function PhotoDetailEditModalComposition({
  open,
  onOpenChange,
  photoId,
  initialColorIds,
  initialTraitIds,
  initialNailLength,
}: PhotoDetailEditModalProps) {
  const t = useTranslations('pages.gallery');
  const updateMutation = useUpdateGalleryRecord();
  const colorsQuery = useGalleryColors();
  const traitsQuery = useGalleryTraits();
  const { colors } = colorsQuery;
  const { traits } = traitsQuery;
  const nailLengthOptions = useNailLengthOptions();

  const [editColorIds, setEditColorIds] = useState<string[]>(initialColorIds);
  const [editTraitIds, setEditTraitIds] = useState<string[]>(initialTraitIds);
  const [editNailLength, setEditNailLength] = useState<NailLength | null>(
    initialNailLength
  );

  // Seed the form from the photo's current tags whenever the modal opens. The
  // dialog is ALWAYS mounted and opened via the controlled `open` prop — Base UI
  // syncs a controlled `open` straight to its store WITHOUT firing onOpenChange,
  // so the reseat must hang off the `open` prop, not the change handler. (The
  // parent populates initialColorIds/Traits/NailLength in handleOpenEdit BEFORE
  // flipping open, and those refs are stable while open, so this seeds once per
  // open and never clobbers an in-progress edit.) Previously the seed lived in
  // handleOpenChange(true), which never fired on programmatic open → the form
  // showed its stale first-mount values (empty) and the user had to re-pick every
  // tag, silently dropping any tag they didn't re-select.
  useEffect(() => {
    if (open) {
      setEditColorIds(initialColorIds);
      setEditTraitIds(initialTraitIds);
      setEditNailLength(initialNailLength);
    }
  }, [open, initialColorIds, initialTraitIds, initialNailLength]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !updateMutation.isPending) {
      onOpenChange(false);
    }
  };

  const handleToggleColor = (colorId: string) => {
    setEditColorIds(prev => toggleCappedSelection(prev, colorId, MAX_COLORS));
  };

  const handleToggleTrait = (traitId: string) => {
    setEditTraitIds(prev => toggleSelection(prev, traitId));
  };

  const canSave =
    editColorIds.length > 0 &&
    editTraitIds.length > 0 &&
    editNailLength !== null;
  // Komplet kolorów: niewybrane próbki są nieaktywne (jak w kreatorze, patrz
  // UploadTagStep), zamiast cichego no-opu przy czwartym kliknięciu.
  const colorsFull = isSelectionFull(editColorIds, MAX_COLORS);

  const handleConfirm = () => {
    if (!editNailLength) {
      return;
    }
    updateMutation.mutate(
      {
        gallery_record_id: photoId,
        color_ids: editColorIds,
        trait_ids: editTraitIds,
        nail_length: editNailLength,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          pushNewSnackbar(t('editSuccess'), 'success');
        },
        // Error toast is owned by the HTTP interceptor (event-bus Stage 1): the
        // backend gallery event or INTERNET_CONNECTION_PROBLEM. Neither the hook nor
        // a call-site onError pushes — a local toast stacked a duplicate (dedup
        // compares raw input; a different key never collapses). Modal stays open on
        // error so the user can retry.
      }
    );
  };

  return (
    <AppDialogAtom
      open={open}
      onOpenChange={handleOpenChange}
      disablePointerDismissal={updateMutation.isPending}>
      <AppDialogAtom.Content title={t('editModalTitle')}>
        <div className={editStyles.body}>
          {/* Colors */}
          <section className={editStyles.section}>
            <header className={editStyles.sectionHeader}>
              <PaletteIcon size={14} weight='fill' aria-hidden='true' />
              <TypographyAtom variant='h4' className={editStyles.sectionTitle}>
                {t('editModalColors', { max: MAX_COLORS })}
              </TypographyAtom>
              {editColorIds.length > 0 && (
                <span className={editStyles.counter}>
                  {t('editModalColorsCounter', {
                    count: editColorIds.length,
                    max: MAX_COLORS,
                  })}
                </span>
              )}
            </header>
            <TagOptionsLoadStateMolecule
              hasOptions={colors.length > 0}
              isLoading={colorsQuery.isLoading}
              isError={colorsQuery.isError}
              errorMessage={t('uploadColorsLoadError')}
              retryLabel={t('retry')}
              onRetry={() => void colorsQuery.refetch()}
              isRetrying={colorsQuery.isFetching}>
              <ColorSwatchGridOrganism className={editStyles.colorGrid}>
                {colors.map(c => {
                  const isSelected = editColorIds.includes(c.id);
                  return (
                    <ColorSwatchMolecule
                      key={c.id}
                      name={c.name}
                      hex={c.hex_code}
                      size='lg'
                      selected={isSelected}
                      disabled={colorsFull && !isSelected}
                      onClick={() => handleToggleColor(c.id)}
                    />
                  );
                })}
              </ColorSwatchGridOrganism>
            </TagOptionsLoadStateMolecule>
          </section>

          {/* Traits */}
          <section className={editStyles.section}>
            <header className={editStyles.sectionHeader}>
              <TagIcon size={14} weight='fill' aria-hidden='true' />
              <TypographyAtom variant='h4' className={editStyles.sectionTitle}>
                {t('editModalTraits')}
              </TypographyAtom>
              {editTraitIds.length > 0 && (
                <span className={editStyles.counter}>
                  {t('editModalTraitsCounter', {
                    count: editTraitIds.length,
                  })}
                </span>
              )}
            </header>
            <TagOptionsLoadStateMolecule
              hasOptions={traits.length > 0}
              isLoading={traitsQuery.isLoading}
              isError={traitsQuery.isError}
              errorMessage={t('uploadTraitsLoadError')}
              retryLabel={t('retry')}
              onRetry={() => void traitsQuery.refetch()}
              isRetrying={traitsQuery.isFetching}>
              <ChipGroupMolecule>
                {traits.map(tr => (
                  <ChipAtom
                    key={tr.id}
                    label={tr.name}
                    size='sm'
                    onClick={() => handleToggleTrait(tr.id)}
                    selected={editTraitIds.includes(tr.id)}
                  />
                ))}
              </ChipGroupMolecule>
            </TagOptionsLoadStateMolecule>
          </section>

          {/* Nail length */}
          <section className={editStyles.section}>
            <header className={editStyles.sectionHeader}>
              <RulerIcon size={14} weight='fill' aria-hidden='true' />
              <TypographyAtom variant='h4' className={editStyles.sectionTitle}>
                {t('editModalNailLength')}
              </TypographyAtom>
            </header>
            <div className={editStyles.lengthGrid}>
              {nailLengthOptions.map(opt => (
                <button
                  key={opt.id}
                  type='button'
                  aria-pressed={editNailLength === opt.id}
                  className={`${editStyles.lengthCard} ${editNailLength === opt.id ? editStyles.lengthCardSelected : ''}`}
                  onClick={() => setEditNailLength(opt.id)}>
                  <TypographyAtom
                    variant='body2'
                    className={editStyles.lengthLabel}>
                    {opt.label}
                  </TypographyAtom>
                </button>
              ))}
            </div>
          </section>
        </div>

        <AppDialogAtom.Actions>
          <ButtonAtom
            variant='outlined'
            size='md'
            icon={<XIcon size={16} />}
            onClick={() => onOpenChange(false)}
            disabled={updateMutation.isPending}>
            {t('editModalCancel')}
          </ButtonAtom>
          <ButtonAtom
            variant='primary'
            size='md'
            icon={<FloppyDiskIcon size={16} />}
            onClick={handleConfirm}
            disabled={!canSave || updateMutation.isPending}
            aria-busy={updateMutation.isPending || undefined}>
            {t('editModalSave')}
          </ButtonAtom>
        </AppDialogAtom.Actions>
      </AppDialogAtom.Content>
    </AppDialogAtom>
  );
}
