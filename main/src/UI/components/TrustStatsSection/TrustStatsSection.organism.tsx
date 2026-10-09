import type { ReactNode } from 'react';
import clsx from 'clsx';
import {
  ImagesIcon,
  ChatCircleTextIcon,
  CameraIcon,
} from '@phosphor-icons/react';
import { ProcessIllustrationMolecule } from '../../assets/ProcessIllustration.molecule';
import { LP_ASSETS } from '../../assets/lpAssets';
import { SectionComposition } from '../Section/Section.composition';
import {
  StatsBandMolecule,
  type StatItem,
} from '../StatsBand/StatsBand.molecule';
import styles from './TrustStatsSection.module.css';

interface TrustBadge {
  icon: ReactNode;
  text: ReactNode;
}

export interface TrustStatsSectionProps {
  /** Eyebrow sekcji (np. „Dlaczego można nam zaufać") — pełni rolę nagłówka. */
  eyebrow: ReactNode;
  /** Body pod eyebrow (brand statement); opcjonalny, ale kanon home go ma. */
  body?: ReactNode;
  /** 3 liczby-dowody — renderowane w zamkniętej ink-karcie (StatsBand). */
  stats?: ReadonlyArray<StatItem>;
  benefitExamples?: ReadonlyArray<{ title: string; body: string }>;
  /** Rząd badge'y zaufania pod kartą (ikona + tekst, separator-kropki w CSS). */
  badges?: ReadonlyArray<TrustBadge>;
  badgesAriaLabel?: string;
  headingId?: string;
  className?: string;
}

/**
 * TrustStatsSection — kanoniczna sekcja „Dlaczego można nam zaufać".
 *
 * DECISION: owner review 2026-10-07 replaced language/commission numerals on
 * home and for-stylists with concrete uses of the product. Legacy numerical
 * content can still use StatsBand; pages supply translated content only.

 */
export function TrustStatsSectionOrganism({
  eyebrow,
  body,
  stats,
  benefitExamples,
  badges,
  badgesAriaLabel,
  headingId = 'trust-heading',
  className,
}: TrustStatsSectionProps) {
  return (
    <SectionComposition
      bordered
      aria-labelledby={headingId}
      className={clsx(
        styles.section,
        benefitExamples && styles.examplesSection,
        className
      )}
      innerClassName={styles.stack}>
      <div className={styles.headLayout}>
        <div className={styles.head}>
          <h2 id={headingId} className={styles.headKicker}>
            {eyebrow}
          </h2>
          {body != null && <p className={styles.body}>{body}</p>}
        </div>
        {benefitExamples && (
          <div className={styles.artwork} aria-hidden='true'>
            <ProcessIllustrationMolecule
              src={LP_ASSETS.contextual.stylists}
              width={1536}
              height={1024}
              sizes='(max-width: 767px) calc(100vw - 32px), 480px'
              alt=''
              className={styles.exampleIllustration}
            />
          </div>
        )}
      </div>
      {benefitExamples ? (
        <div className={styles.benefitExamples}>
          {benefitExamples.map((item, index) => (
            <article className={styles.useCase} key={item.title}>
              <span className={styles.exampleIcon} aria-hidden='true'>
                {
                  [
                    <ImagesIcon key='gallery' />,
                    <ChatCircleTextIcon key='notes' />,
                    <CameraIcon key='visit' />,
                  ][index % 3]
                }
              </span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      ) : (
        stats && <StatsBandMolecule variant='ink-card' items={stats} />
      )}
      {badges != null && badges.length > 0 && (
        <ul className={styles.badges} aria-label={badgesAriaLabel}>
          {badges.map((badge, idx) => (
            <li key={idx}>
              {badge.icon}
              {badge.text}
            </li>
          ))}
        </ul>
      )}
    </SectionComposition>
  );
}
