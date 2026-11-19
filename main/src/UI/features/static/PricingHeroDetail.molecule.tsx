import Image from 'next/image';
import { LP_ASSETS } from '../../assets/lpAssets';
import styles from './PricingPage.module.css';

/** Quiet decorative detail with no entry in the accessible reading order. */
export function PricingHeroDetailMolecule() {
  return (
    <span className={styles.heroDetail} aria-hidden='true'>
      <Image src={LP_ASSETS.decor.pricingIntro} alt='' width={80} height={80} />
    </span>
  );
}
