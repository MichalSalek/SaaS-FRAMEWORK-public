// admin/components/TraitRow.molecule.tsx
// One trait, in the panel's one row look. Its category is the label of the
// group it sits in (TraitsTab), so the row does not repeat it.

import { useTranslations } from 'next-intl';
import type { TraitCategory } from '@kernel/models/db_models.manual.dto';
import { NavRowMolecule } from '../../../components/NavRow/NavRow.molecule';
import { AppMenuAtom } from '../../../primitives/AppMenu.atom';
import type { AdminTrait } from '../hooks/useAdminTraits';

// Kategorie z kernelowego SSOT (TRAIT_CATEGORIES), etykiety z i18n — lokalna
// lista dublowała unię i miała angielskie etykiety poza t().
export const TRAIT_CATEGORY_LABEL_KEY = {
  technique: 'categoryTechnique',
  finish: 'categoryFinish',
  decoration: 'categoryDecoration',
  style: 'categoryStyle',
} as const satisfies Record<TraitCategory, string>;

interface TraitRowProps {
  trait: AdminTrait;
  onEdit: (trait: AdminTrait) => void;
  onDelete: (trait: AdminTrait) => void;
}

export function TraitRowMolecule({ trait, onEdit, onDelete }: TraitRowProps) {
  const t = useTranslations('admin.colorsTraits');
  return (
    <NavRowMolecule
      label={trait.name}
      ariaLabel={t('editRowAriaLabel', { name: trait.name })}
      onClick={() => onEdit(trait)}
      end={
        <AppMenuAtom>
          <AppMenuAtom.MoreTrigger
            label={t('rowMenuAriaLabel', { name: trait.name })}
          />
          <AppMenuAtom.Content align='end'>
            <AppMenuAtom.Item onClick={() => onEdit(trait)}>
              {t('menuEdit')}
            </AppMenuAtom.Item>
            <AppMenuAtom.Item tone='danger' onClick={() => onDelete(trait)}>
              {t('menuDelete')}
            </AppMenuAtom.Item>
          </AppMenuAtom.Content>
        </AppMenuAtom>
      }
    />
  );
}
