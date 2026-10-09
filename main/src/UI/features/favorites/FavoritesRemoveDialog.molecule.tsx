// UI/features/favorites/FavoritesRemoveDialog.molecule.tsx
// One confirmation for both removals on this screen (a liked style, a liked
// stylist). Removing is a single tap on a permanently visible control, so it
// asks first.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { AppDialogAtom } from '../../primitives/AppDialog.atom';

export type FavoritesRemoval =
  { kind: 'style'; id: string } | { kind: 'stylist'; id: string; name: string };

export function FavoritesRemoveDialogMolecule({
  removal,
  onConfirm,
  onClose,
}: {
  removal: FavoritesRemoval | null;
  onConfirm: (removal: FavoritesRemoval) => void;
  onClose: () => void;
}) {
  const t = useTranslations('pages.favorites');
  const tButtons = useTranslations('buttons');
  // The dialog fades out AFTER `removal` is cleared: keep showing the last
  // question instead of switching to the other variant's title mid-fade.
  const [shown, setShown] = useState(removal);
  if (removal !== null && removal !== shown) {
    setShown(removal);
  }
  return (
    <AppDialogAtom
      open={removal !== null}
      onOpenChange={open => {
        if (!open) {
          onClose();
        }
      }}>
      <AppDialogAtom.Content
        title={
          shown?.kind === 'stylist'
            ? t('removeStylistDialogTitle')
            : t('removeDialogTitle')
        }
        description={
          shown?.kind === 'stylist'
            ? t('removeStylistDialogBody', { name: shown.name })
            : t('removeDialogBody')
        }>
        <AppDialogAtom.Actions>
          <ButtonAtom variant='outlined' size='md' onClick={onClose}>
            {tButtons('no')}
          </ButtonAtom>
          <ButtonAtom
            variant='danger'
            size='md'
            onClick={() => {
              if (removal !== null) {
                onConfirm(removal);
              }
            }}>
            {t('removeDialogConfirm')}
          </ButtonAtom>
        </AppDialogAtom.Actions>
      </AppDialogAtom.Content>
    </AppDialogAtom>
  );
}
