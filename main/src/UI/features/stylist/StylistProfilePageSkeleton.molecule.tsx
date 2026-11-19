import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import styles from './StylistProfilePage.module.css';

/** Loading state in the geometry of the loaded page: the identity box (round
 *  avatar next to two lines), then the works grid with its heading. */
export function StylistProfilePageSkeletonMolecule() {
  return (
    <div className={styles.page} aria-busy='true'>
      <div className={styles.profileHero}>
        <div className={styles.profileBody}>
          <div className={styles.profileAvatar}>
            <SkeletonAtom variant='circle' width={72} height={72} />
          </div>
          <div className={styles.profileMeta}>
            <SkeletonAtom variant='text' width='60%' height={28} />
            <SkeletonAtom variant='text' width='40%' height={18} />
          </div>
        </div>
      </div>

      <section className={styles.section}>
        <SkeletonAtom variant='text' width='55%' height={24} />
        <div className={styles.galleryGrid}>
          {[0, 1, 2, 3].map(i => (
            <SkeletonAtom
              key={i}
              variant='rect'
              width='100%'
              height={0}
              className={styles.skeletonPhoto}
            />
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.actionRow}>
          <SkeletonAtom variant='rect' width={160} height={44} />
        </div>
      </section>
    </div>
  );
}
