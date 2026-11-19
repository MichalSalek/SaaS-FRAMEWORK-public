import { type ReactNode } from 'react';
import { ShieldCheckIcon } from '@phosphor-icons/react';
import styles from './LegalDocLayout.module.css';

/* ─── Composition primitives for LegalDocLayout body content ─── */

interface LegalSectionProps {
  id: string;
  title: string;
  children: ReactNode;
}

/** Renders a section heading and dashed divider. */
export function LegalSectionMolecule({
  id,
  title,
  children,
}: LegalSectionProps) {
  return (
    <section id={id} className={styles.section}>
      <header className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{title}</h2>
      </header>
      {children}
    </section>
  );
}

interface LegalParagraphProps {
  children: ReactNode;
}

/** Body paragraph — 75 line-height, pretty wrap, hyphens, brand-tuned color. */
export function LegalParagraphAtom({ children }: LegalParagraphProps) {
  return <p className={styles.sectionText}>{children}</p>;
}

interface LegalCalloutProps {
  children: ReactNode;
  icon?: ReactNode;
}

/** Brand-tinted highlight box for "important" info inside a section. */
export function LegalCalloutMolecule({ children, icon }: LegalCalloutProps) {
  return (
    <div className={styles.calloutNote}>
      <span className={styles.calloutIcon} aria-hidden='true'>
        {icon ?? <ShieldCheckIcon size={14} weight='regular' />}
      </span>
      <span className={styles.calloutText}>{children}</span>
    </div>
  );
}

export { styles as legalDocStyles };
