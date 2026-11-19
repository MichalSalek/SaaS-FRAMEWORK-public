import { useTranslations } from 'next-intl';
import { SectionComposition } from '../../components/Section/Section.composition';
import { SectionHeaderMolecule } from '../../components/SectionHeader/SectionHeader.molecule';
import { ProcessIllustrationMolecule } from '../../assets/ProcessIllustration.molecule';
import { LP_ASSETS } from '../../assets/lpAssets';
import styles from './ForStudiosGallerySection.module.css';

const STEPS = ['capture', 'public', 'client'] as const;

export function ForStudiosGallerySectionOrganism() {
  const source = LP_ASSETS.contextual.salonSharedGallery;
  const t = useTranslations('static.forStudios.gallery');
  return (
    <SectionComposition tone='white'>
      <SectionHeaderMolecule title={t('headline')}>
        {t('lede')}
      </SectionHeaderMolecule>
      <ol className={styles.steps}>
        {STEPS.map((step, index) => (
          <li key={step} className={styles.step}>
            <span className={styles.number} aria-hidden='true'>
              {String(index + 1).padStart(2, '0')}
            </span>
            <h3 className={styles.title}>{t(`${step}Title`)}</h3>
            <p className={styles.body}>{t(`${step}Body`)}</p>
          </li>
        ))}
      </ol>
      {source && (
        <ProcessIllustrationMolecule
          src={source}
          width={1536}
          height={1024}
          sizes='(max-width: 767px) calc(100vw - 32px), 768px'
          alt={t('illustrationAlt')}
          className={styles.illustration}
        />
      )}
    </SectionComposition>
  );
}
