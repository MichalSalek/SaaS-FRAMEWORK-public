// The colour dots of a gallery card: the work's polish colours. Named for
// screen readers and on pointer rest, so a dot is never an unexplained mark.
import { useLocale, useTranslations } from 'next-intl';
import type { ColorDTO } from '@kernel/models/db_models.manual.dto';
import { getLocalizedTaxonomyName } from '../../../domain/gallery/gallery-taxonomy.locale';
import { ColorDotAtom } from '../ColorDot/ColorDot.atom';
import styles from './GalleryPhotoCard.module.css';

export function GalleryPhotoCardColorsMolecule({
  colors,
}: {
  colors: ColorDTO[];
}) {
  const t = useTranslations('galleryCard');
  const locale = useLocale();
  const label = t('colorsLabel', {
    names: colors.map(c => getLocalizedTaxonomyName(c.name, locale)).join(', '),
  });
  return (
    <div
      className={styles.colorDots}
      role='img'
      aria-label={label}
      title={label}>
      {colors.map(c => (
        <ColorDotAtom key={c.id} color={c.hex_code} size='sm' />
      ))}
    </div>
  );
}
