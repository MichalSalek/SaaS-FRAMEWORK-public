// admin/components/ColorRow.molecule.tsx
// One colour of the palette, in the panel's one row look: the swatch, the
// name, its code. Tapping the row edits it; the menu holds edit and delete.

import { useTranslations } from 'next-intl';
import { NavRowMolecule } from '../../../components/NavRow/NavRow.molecule';
import { ColorDotAtom } from '../../../components/ColorDot/ColorDot.atom';
import { AppMenuAtom } from '../../../primitives/AppMenu.atom';
import type { AdminColor } from '../hooks/useAdminColors';

interface ColorRowProps {
  color: AdminColor;
  onEdit: (color: AdminColor) => void;
  onDelete: (color: AdminColor) => void;
}

export function ColorRowMolecule({ color, onEdit, onDelete }: ColorRowProps) {
  const t = useTranslations('admin.colorsTraits');
  return (
    <NavRowMolecule
      leading={<ColorDotAtom color={color.hex_code} size='lg' />}
      label={color.name}
      description={color.hex_code}
      ariaLabel={t('editRowAriaLabel', { name: color.name })}
      onClick={() => onEdit(color)}
      end={
        <AppMenuAtom>
          <AppMenuAtom.MoreTrigger
            label={t('rowMenuAriaLabel', { name: color.name })}
          />
          <AppMenuAtom.Content align='end'>
            <AppMenuAtom.Item onClick={() => onEdit(color)}>
              {t('menuEdit')}
            </AppMenuAtom.Item>
            <AppMenuAtom.Item tone='danger' onClick={() => onDelete(color)}>
              {t('menuDelete')}
            </AppMenuAtom.Item>
          </AppMenuAtom.Content>
        </AppMenuAtom>
      }
    />
  );
}
