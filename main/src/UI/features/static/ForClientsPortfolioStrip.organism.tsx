import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
import { LP_ASSETS } from '../../assets/lpAssets';
import styles from './ForClientsPage.module.css';

/* ─── 3c. PORTFOLIO STRIP — głos S22/4 = B (film-strip): pozioma taśma
 * 6 gołych zdjęć równej wysokości jako visual-divider między benefits
 * a reviews; mobile przewijana ze snapem, zero podpisów. Forma 1:1
 * z playground S22Vote4PortfolioStrip (wariant B); zdjęcia 1:1
 * z nail-bank-manifest.json, alt-y przez i18n (portfolio.alt1-6 ×3). ─── */
// Adjacent photos vary in length, palette and setting; alt keys follow their sources.
const STRIP_PHOTOS: ReadonlyArray<{ src: string; altKey: string }> = [
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
];

export function ForClientsPortfolioStripSectionOrganism() {
  const t = useTranslations('static.forClients');

  return (
    <section className={styles.stripSection}>
      <div className={styles.stripHeader}>
        <EyebrowAtom as='p' variant='plain'>
          {t('portfolio.eyebrow')}
        </EyebrowAtom>
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
