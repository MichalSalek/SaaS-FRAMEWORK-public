import type { ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { HeartIcon } from '@phosphor-icons/react';
import { getLocalizedTaxonomyName } from '../../../domain/gallery/gallery-taxonomy.locale';
import { ChipAtom, ChipGroupMolecule } from '../Chip/Chip.atom';
import type { ColorDTO, TraitDTO } from '@kernel/models/db_models.manual.dto';
import { GalleryPhotoCardColorsMolecule } from './GalleryPhotoCardColors.molecule';
import styles from './GalleryPhotoCard.module.css';

export function GalleryPhotoCardInfoMolecule({
  record,
  likeCount,
  footer,
}: {
  record: { colors: ColorDTO[]; traits: TraitDTO[] };
  likeCount: number | null;
  footer: ReactNode;
}) {
  const locale = useLocale();
  return (
    <div className={styles.info}>
      {record.colors.length > 0 && (
        <GalleryPhotoCardColorsMolecule colors={record.colors} />
      )}
      {record.traits.length > 0 && (
        <ChipGroupMolecule className={styles.traitChips}>
          {record.traits.map(trait => (
            <ChipAtom
              key={trait.id}
              label={getLocalizedTaxonomyName(trait.name, locale)}
              size='sm'
            />
          ))}
        </ChipGroupMolecule>
      )}
      {likeCount != null && likeCount >= 3 && (
        <div className={styles.likeCount}>
          <HeartIcon size={14} />
          <span>{likeCount}</span>
        </div>
      )}
      {footer}
    </div>
  );
}
