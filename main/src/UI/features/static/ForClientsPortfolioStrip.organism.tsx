import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { LP_ASSETS } from '../../assets/lpAssets';
import styles from './ForClientsPage.module.css';

/* Portfolio strip: a horizontal band of 6 bare photos at equal height,
 * a visual divider between benefits and reviews. Mobile scrolls with snap,
 * no captions. Photos match nail-bank-manifest.json. Alts are i18n
 * (portfolio.alt1-6, three locales). */
// Adjacent photos vary in length, palette and setting; alt keys follow their sources.
const STRIP_PHOTOS = [
  {
    src: LP_ASSETS.portfolio.nail52ChampagneChromeSilk,
    altKey: 'portfolio.alt4',
  },
  { src: LP_ASSETS.portfolio.manicure06, altKey: 'portfolio.alt6' },
  { src: LP_ASSETS.portfolio.manicure03, altKey: 'portfolio.alt2' },
  {
    src: LP_ASSETS.portfolio.nail42MediumSageMicroFrench,
    altKey: 'portfolio.alt5',
  },
  {
    src: LP_ASSETS.portfolio.nailDiscover02,
    altKey: 'portfolio.alt1',
  },
  { src: LP_ASSETS.portfolio.manicure01, altKey: 'portfolio.alt3' },
] as const satisfies ReadonlyArray<{ src: string; altKey: string }>;

export function ForClientsPortfolioStripSectionOrganism() {
  const t = useTranslations('static.forClients');

  return (
    <section className={styles.stripSection}>
      <div className={styles.stripHeader}>
        <p className={styles.stripTitle}>{t('portfolio.headline')}</p>
      </div>
      <div className={styles.strip}>
        {STRIP_PHOTOS.map(photo => (
          <figure key={photo.src} className={styles.stripItem}>
            <Image
              className={styles.coverImage}
              src={photo.src}
              alt={t(photo.altKey)}
              fill
              sizes='(max-width: 1023px) 45vw, 17vw'
            />
          </figure>
        ))}
      </div>
    </section>
  );
}
