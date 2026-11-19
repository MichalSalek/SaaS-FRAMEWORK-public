// UI/features/account/ActivateRolePage.parts.tsx
// Presentational pieces of ActivateRolePage: what the account gives (the one
// white box), the facts about a second account (plain list on paper) and the
// consent row that sits right above the action.

import type { useTranslations } from 'next-intl';
import { CheckIcon } from '@phosphor-icons/react';
import { legalLinkChunks } from '../shared/legal/legal-link-chunks.helpers';
import styles from './ActivateRolePage.module.css';

type TFn = ReturnType<typeof useTranslations<'account.activate'>>;

/* ─── Benefits card ───
 * DECISION: the list is read-only, so it carries no raspberry discs or numbered medallions (they
 * looked like buttons): a check mark in the text color, the sentence beside it, no lines between
 * rows. (owner) */
interface BenefitsCardProps {
  title: string;
  benefits: readonly string[];
}

export function BenefitsCardOrganism({ title, benefits }: BenefitsCardProps) {
  return (
    <section className={styles.benefitsCard}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <ul className={styles.benefitsList}>
        {benefits.map(text => (
          <li key={text} className={styles.benefitItem}>
            <span className={styles.lineIcon} aria-hidden='true'>
              <CheckIcon size={18} weight='bold' />
            </span>
            <span className={styles.benefitText}>{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ─── Facts about a second account (information: on paper, no box) ─── */
interface FactsListProps {
  title: string;
  facts: readonly string[];
}

export function FactsListOrganism({ title, facts }: FactsListProps) {
  return (
    <section>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <ul className={styles.factsList}>
        {facts.map(text => (
          <li key={text}>{text}</li>
        ))}
      </ul>
    </section>
  );
}

/* ─── Terms line (right under the action; activating accepts the terms) ─── */
export function ActivateTermsNoticeMolecule({ t }: { t: TFn }) {
  return (
    <p className={styles.termsNotice}>
      {t.rich('termsNotice', legalLinkChunks(styles.termsLink))}
    </p>
  );
}
