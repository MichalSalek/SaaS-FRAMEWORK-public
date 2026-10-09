// UI/features/account/AccountPayPage.parts.organism.tsx
// The role-switch prompt and the FAQ of the pay page. The billing card and the
// plan-list header live in .hero.organism.tsx, the plan card in
// .planCard.organism.tsx (300 LOC ceiling per file).

import { UserSwitchIcon } from '@phosphor-icons/react';
import {
  AccordionItemMolecule,
  type AccordionItemClassNames,
} from '../../components/Accordion/AccordionItem.molecule';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import styles from './AccountPayPage.module.css';

export type { PlanTranslations } from './AccountPayPage.planCard.organism';
export {
  PlanCardOrganism,
  buildPlanTx,
} from './AccountPayPage.planCard.organism';

/* ============================================================
 *  ROLE-SWITCH PROMPT — dual-role user viewing /pay in CLIENT mode.
 *  Billing = STYLIST surface (checkout RBAC gates by active role), so every
 *  plan action would 403 UNAUTHORIZED and dead-loop the checkout panel's
 *  generic sessionError+retry. Pre-empt with a switch affordance instead:
 *  switch to stylist mode → the page re-renders with billing enabled (and any
 *  pricing funnel auto-opens checkout).
 * ============================================================ */

interface PayRoleSwitchProps {
  title: string;
  body: string;
  ctaLabel: string;
  isSwitching: boolean;
  onSwitch: () => void;
}

export function PayRoleSwitchOrganism({
  title,
  body,
  ctaLabel,
  isSwitching,
  onSwitch,
}: PayRoleSwitchProps) {
  return (
    <div className={styles.page}>
      <EmptyStateAtom
        size='page'
        role='status'
        icon={<UserSwitchIcon size={32} weight='duotone' />}
        title={title}
        titleAs='h2'
        description={body}
        action={
          <ButtonAtom
            variant='primary'
            size='lg'
            onClick={onSwitch}
            disabled={isSwitching}
            loading={isSwitching}>
            {ctaLabel}
          </ButtonAtom>
        }
      />
    </div>
  );
}

/* ============================================================
 *  FAQ — one column of closed questions (shared accordion mechanics)
 * ============================================================ */

export interface FaqEntry {
  q: string;
  a: string;
}

type PayTranslateFn = (key: string) => string;

/** The five account-pay FAQ q/a pairs, resolved from the account.pay namespace. */
export function buildPayFaq(t: PayTranslateFn): readonly FaqEntry[] {
  return [
    { q: t('faq.q1'), a: t('faq.a1') },
    { q: t('faq.q2'), a: t('faq.a2') },
    { q: t('faq.q3'), a: t('faq.a3') },
    { q: t('faq.q4'), a: t('faq.a4') },
    { q: t('faq.q5'), a: t('faq.a5') },
  ];
}

interface PayFaqProps {
  title: string;
  entries: readonly FaqEntry[];
}

const FAQ_CLASS_NAMES: AccordionItemClassNames = {
  item: styles.faqItem ?? '',
  trigger: styles.faqQuestion ?? '',
  chevron: styles.faqCaret ?? '',
  content: styles.faqContent ?? '',
  answer: styles.faqAnswer ?? '',
};

// DECISION (nie usuwaj tego komentarza) — S126:
// One column, every question closed. From 680px the list used to be a
// two-column grid of native <details>: an open answer left its neighbour as a
// blank cell, and the first answer was open by default, so the secondary
// section took a screen of its own. The shared accordion animates the opening
// (a native <details> jumps), and the measure is capped in CSS so a question
// row never runs 900px wide.
export function PayFaqOrganism({ title, entries }: PayFaqProps) {
  return (
    <section className={styles.faqSection}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <div className={styles.faqList}>
        {entries.map((entry, index) => (
          <AccordionItemMolecule
            key={entry.q}
            idPrefix='pay-faq'
            index={index}
            question={entry.q}
            answer={entry.a}
            classNames={FAQ_CLASS_NAMES}
          />
        ))}
      </div>
    </section>
  );
}
