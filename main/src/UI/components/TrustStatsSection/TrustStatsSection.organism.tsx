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

export interface TrustStatsSectionProps {
  /** Accessible name for the section after its visible heading was removed. */
  ariaLabel: string;
  /** Body supporting the section's examples or statistics. */
  body?: ReactNode;
  /** 3 liczby-dowody — renderowane w zamkniętej ink-karcie (StatsBand). */
  stats?: ReadonlyArray<StatItem>;
  benefitExamples?: ReadonlyArray<{ title: string; body: string }>;
  className?: string;
}

/**
 * TrustStatsSection — kanoniczna sekcja „Dlaczego można nam zaufać".
 *
 * DECISION: the section carries concrete uses of the product instead of language/commission
 * numerals (owner); legacy numerical content can still use StatsBand, and pages supply
 * translated content only.
 *
 * DECISION: the section no longer carries a row of assurances ("Płatności przez Stripe", "Prywatne
 * galerie", "0% prowizji od klientek"): they repeated under sections about something else.
 * Payment and data assurances stand only next to prices (pricing page and the plan preview on the
 * for-salons page). Do not bring back the `badges` prop. (owner)

 */
export function TrustStatsSectionOrganism({
  ariaLabel,
  body,
  stats,
  benefitExamples,
  className,
}: TrustStatsSectionProps) {
  return (
    <SectionComposition
      bordered
      aria-label={ariaLabel}
      className={clsx(
        styles.section,
        benefitExamples && styles.examplesSection,
        className
      )}
      innerClassName={styles.stack}>
      <div className={styles.headLayout}>
        <div className={styles.head}>
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
    </SectionComposition>
  );
}
