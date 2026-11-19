import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { CaretDownIcon } from '@phosphor-icons/react';
import type { UiLibraryEntryMeta } from './uiLibrary.registry';
import styles from './UiLibraryPage.module.css';

/**
 * Borderless implementation disclosure: muted caption + chevron, content
 * animates via grid-rows 0fr→1fr + opacity. No chrome: it sits on the
 * entry/page surface so the catalog stays a gallery, not a spec sheet.
 */
export function LibraryDisclosureComposition({
  id,
  summary,
  children,
}: {
  id: string;
  summary: string;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = `${id}-details`;
  const triggerId = `${id}-details-trigger`;

  return (
    <div className={styles.disclosure}>
      <button
        id={triggerId}
        type='button'
        className={styles.disclosureTrigger}
        onClick={() => setIsOpen(prev => !prev)}
        aria-expanded={isOpen}
        aria-controls={panelId}>
        <span>{summary}</span>
        <CaretDownIcon
          size={16}
          className={styles.disclosureChevron}
          data-open={isOpen || undefined}
          aria-hidden='true'
        />
      </button>
      <div
        className={styles.disclosurePanel}
        data-open={isOpen || undefined}
        aria-hidden={!isOpen}>
        <div className={styles.disclosureClip}>
          <div
            id={panelId}
            role='region'
            aria-labelledby={triggerId}
            className={styles.disclosureBody}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Single catalog entry: name + status + live demo. Import path, when-to-use,
 * notes and noRenderReason live in one collapsed disclosure under the demo.
 * Anchor `id` stays on the article so TOC links keep working.
 */
export function LibraryEntryComposition({
  meta,
  note,
  children,
}: {
  meta: UiLibraryEntryMeta;
  /** Extra implementation note (demo limits, auth, etc.). */
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <article id={meta.id} className={styles.entry}>
      <header className={styles.entryHeader}>
        <h3 className={styles.entryName}>{meta.name}</h3>
        <span
          className={clsx(
            styles.status,
            meta.status === 'FROZEN' ? styles.statusFrozen : styles.statusDraft
          )}>
          {meta.status}
        </span>
      </header>
      {children != null && <div className={styles.demo}>{children}</div>}
      <LibraryDisclosureComposition
        id={meta.id}
        summary='Szczegóły dla wdrożenia'>
        <code className={styles.importPath}>{meta.importPath}</code>
        <p className={styles.whenToUse}>{meta.whenToUse}</p>
        {meta.noRenderReason != null && (
          <p className={styles.note}>
            Bez żywego renderu: {meta.noRenderReason}
          </p>
        )}
        {note != null && <p className={styles.note}>{note}</p>}
      </LibraryDisclosureComposition>
    </article>
  );
}

/** Library group section (Atoms / Molecules / Molecules LP). */
export function LibrarySectionComposition({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={styles.section} aria-label={title}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

/**
 * Variant row inside a demo, with an optional micro-label above the row.
 * Self-closing (label only) labels a full-width render that does not fit
 * a flex row (hero, band, section).
 */
export function DemoRowComposition({
  label,
  children,
}: {
  label?: string;
  children?: ReactNode;
}) {
  return (
    <div className={styles.demoRow}>
      {label != null && <span className={styles.demoLabel}>{label}</span>}
      {children}
    </div>
  );
}
