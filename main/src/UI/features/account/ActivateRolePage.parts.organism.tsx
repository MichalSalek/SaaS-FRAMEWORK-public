// UI/features/account/ActivateRolePage.parts.tsx
// Presentational pieces of ActivateRolePage: what the account gives (the one
// white box), the facts about a second account (plain list on paper) and the
// consent row that sits right above the action.

import { AppLinkAtom as Link } from '../../components/AppLink/AppLink.atom';
import type { useTranslations } from 'next-intl';
import { CheckIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { CheckboxAtom } from '../../components/Checkbox/Checkbox.atom';
import styles from './ActivateRolePage.module.css';

type TFn = ReturnType<typeof useTranslations<'account.activate'>>;

/* ─── Benefits card ───
 * DECISION (nie usuwaj tego komentarza) — owner 2026-10-08:
 * lista jest tylko do czytania, więc nie nosi malinowych krążków ani
 * numerowanych medalionów (wyglądały jak przyciski). Znak wyboru w kolorze
 * tekstu, zdanie obok, bez linii między wierszami. */
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

/* ─── Consent row (lives in the bottom bar, right above the action) ─── */
interface ActivateConsentProps {
  termsAccepted: boolean;
  onChange: (next: boolean) => void;
  showError: boolean;
  errorId: string;
  t: TFn;
}

export function ActivateConsentOrganism({
  termsAccepted,
  onChange,
  showError,
  errorId,
  t,
}: ActivateConsentProps) {
  return (
    <div className={styles.consent}>
      <div className={styles.termsRow}>
        <CheckboxAtom
          checked={termsAccepted}
          onChange={e => onChange(e.target.checked)}
          aria-label={t('termsAriaLabel')}
          aria-invalid={showError}
          {...(showError ? { 'aria-describedby': errorId } : {})}
        />
        <p className={styles.termsLabel}>
          {t.rich('termsAccept', {
            terms: chunks => (
              <Link
                prefetch={false}
                href={ROUTES_FRONT.TERMS}
                className={styles.termsLink}
                target='_blank'
                rel='noopener noreferrer'>
                {chunks}
              </Link>
            ),
            privacy: chunks => (
              <Link
                prefetch={false}
                href={ROUTES_FRONT.PRIVACY}
                className={styles.termsLink}
                target='_blank'
                rel='noopener noreferrer'>
                {chunks}
              </Link>
            ),
          })}
        </p>
      </div>
      {/* Always mounted: the line under the consent keeps its height, so the
          button does not jump when the explanation appears. */}
      <p
        id={errorId}
        className={styles.termsError}
        data-visible={showError || undefined}
        role={showError ? 'alert' : undefined}
        aria-hidden={!showError}>
        <span className={styles.lineIcon} aria-hidden='true'>
          <WarningCircleIcon size={16} weight='fill' />
        </span>
        <span>{t('termsRequired')}</span>
      </p>
    </div>
  );
}
