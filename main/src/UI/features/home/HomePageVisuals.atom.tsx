import Image from 'next/image';
import { LP_ASSETS } from '../../assets/lpAssets';
import type { BENEFITS } from './homePageData';
import { useTranslations } from 'next-intl';
import {
  ArrowRightIcon,
  CheckCircleIcon,
  SealPercentIcon,
  HandCoinsIcon,
} from '@phosphor-icons/react';
import { TrustSignalsMolecule } from '../../components/TrustSignals/TrustSignals.molecule';
import styles from './HomePage.module.css';

/* ─── Hero proof list (extracted to keep HomePage.tsx under max-lines) ─── */

export function HeroProofListAtom() {
  const t = useTranslations('pages.home');
  return (
    <TrustSignalsMolecule
      variant='pills'
      className={styles.heroProof}
      ariaLabel={t('hero.proofAriaLabel')}
      items={[
        {
          icon: <SealPercentIcon size={14} weight='regular' />,
          text: t('hero.proof1'),
        },
        {
          icon: <HandCoinsIcon size={14} weight='regular' />,
          text: t('hero.proof2'),
        },
        {
          icon: <CheckCircleIcon size={14} weight='regular' />,
          text: t('hero.proof3'),
        },
      ]}
    />
  );
}

/* ─── Mini QR mockup for benefit 04 (Session Share) ─── */

export function MiniQrVisualAtom() {
  const cells = [
    [1, 1, 1, 0, 1, 1, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 1, 1, 0, 1, 1, 1],
    [0, 1, 0, 1, 0, 1, 0],
    [1, 1, 1, 0, 1, 1, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 1, 1, 0, 1, 1, 1],
  ];
  return (
    <svg
      viewBox='0 0 84 84'
      className={styles.benefitSvg}
      aria-hidden='true'
      focusable='false'>
      {cells.map((row, r) =>
        row.map((cell, c) =>
          cell ? (
            <rect
              key={`${r}-${c}`}
              x={c * 12}
              y={r * 12}
              width='10'
              height='10'
              rx='1.5'
              fill='currentColor'
            />
          ) : null
        )
      )}
    </svg>
  );
}

/** Illustrate only features with a useful visual; keep the other cards quiet. */
export function BenefitVisualAtom({
  kind,
}: {
  kind: (typeof BENEFITS)[number]['n'];
}) {
  const t = useTranslations('pages.home');
  if (kind === 'b1') {
    return (
      <div className={styles.benefitGalleryVisual} aria-hidden='true'>
        {[
          LP_ASSETS.hero.heroNail18CherryBottle,
          LP_ASSETS.portfolio.nail42MediumSageMicroFrench,
          LP_ASSETS.hero.heroNail17GlazedKnit,
        ].map(src => (
          <div key={src} className={styles.benefitGalleryPhoto}>
            <Image
              src={src}
              alt=''
              fill
              sizes='(max-width: 767px) 25vw, 180px'
              quality={95}
            />
          </div>
        ))}
      </div>
    );
  }
  if (kind === 'b3') {
    return (
      <div className={styles.benefitConnectionVisual} aria-hidden='true'>
        <MiniQrVisualAtom />
      </div>
    );
  }
  if (kind !== 'b4') {
    return null;
  }
  return (
    <>
      <div className={styles.benefitWideVisual} aria-hidden='true'>
        <div className={styles.benefitWideArrow}>
          <span className={styles.benefitWideArrowLabel}>
            {t('benefits.clientLabel')}
          </span>
          <ArrowRightIcon
            className={styles.benefitWideArrowGlyph}
            weight='regular'
          />
          <span className={styles.benefitWideArrowLabel}>
            {t('benefits.youLabel')}
          </span>
        </div>
      </div>
      <Image
        className={styles.benefitStoryImage}
        src={LP_ASSETS.process.clientBeforeVisit}
        alt=''
        width={1774}
        height={887}
        sizes='(max-width: 767px) 85vw, 700px'
        quality={95}
      />
    </>
  );
}
