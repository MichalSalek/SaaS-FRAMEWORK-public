// UI/layouts/AdminPageLayout.tsx
// Shared admin page shell — wraps AdminLayout with a portfolio-tier
// PageHeader (eyebrow chip + title in the --font-heading role + actions slot).
//
// Used by all admin pages to keep visual rhythm consistent (W8 batch).
// Pattern: flat editorial hero — solid tonal surface, hairline border, gold accents
// (NO box-shadow elevation, NO gradient wash; anti-slop floor).

import { useRef, type ReactNode, type CSSProperties } from 'react';
import { AdminLayoutComposition } from './AdminLayout.composition';
import { useReportHeroVisibility } from '../components/AppHero/useReportHeroVisibility';
import { EyebrowAtom } from '../components/Eyebrow/Eyebrow.atom';
import styles from './AdminPageLayout.module.css';

export interface AdminPageLayoutProps {
  /** Translated title fed to <AdminLayout> (mobile top bar). */
  documentTitle: string;
  /** Optional uppercase eyebrow above the title (e.g. "ADMIN", "MONITORING"). */
  eyebrow?: string;
  /** Marcellus-serif page title rendered in the page header. */
  title: ReactNode;
  /** Optional secondary line under the title (read-only context). */
  subtitle?: ReactNode;
  /** Optional actions slot rendered to the right of the header (button, etc.). */
  actions?: ReactNode;
  /** Optional pill rendered just under the actions (e.g. "Live", "30s"). */
  meta?: ReactNode;
  /** Page body. */
  children: ReactNode;
}

/**
 * AdminPageLayout
 *
 * DECISION (nie usuwaj tego komentarza) — głos ownera `s126-admin`,
 * 2026-10-09: wygrał układ DZIŚ. Ten nagłówek (etykieta, tytuł, podtytuł,
 * akcje) jest jedynym wzorem strony admina; trzy kandydaty z pięcioma
 * modułami i zakładkami pod tytułem przegrały i zostały usunięte. Powód
 * ownera stoi przy menu: `AdminLayout.sidebar.config.tsx`.
 *
 * Composes existing AdminLayout (sidebar/topbar) with a shared header band.
 * The header bleeds across the content padding (negative margin trick) to
 * read as a true editorial banner rather than an inset card.
 */
export function AdminPageLayoutComposition({
  documentTitle,
  eyebrow = 'ADMIN',
  title,
  subtitle,
  actions,
  meta,
  children,
}: AdminPageLayoutProps) {
  return (
    <AdminLayoutComposition title={documentTitle}>
      <div className={styles.page}>
        <AdminPageHeader
          eyebrow={eyebrow}
          title={title}
          subtitle={subtitle}
          actions={actions}
          meta={meta}
        />
        <div className={styles.body}>{children}</div>
      </div>
    </AdminLayoutComposition>
  );
}

/* The header band is a child of AdminLayout, so it can report to the bar. */
function AdminPageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  meta,
}: Pick<
  AdminPageLayoutProps,
  'eyebrow' | 'title' | 'subtitle' | 'actions' | 'meta'
>) {
  // The band carries the page <h1>. While it is on screen the top bar would
  // only repeat it, so the bar hides its title and brings it back once the
  // band scrolls away (the same large-title mechanism as the app's AppHero).
  const headerRef = useRef<HTMLElement>(null);
  useReportHeroVisibility(headerRef);

  return (
    <header
      ref={headerRef}
      className={`${styles.header} ${styles.staggerIn}`}
      style={{ '--stagger-index': 0 } as CSSProperties}>
      <div className={styles.headerInner}>
        <div className={styles.headerText}>
          {eyebrow !== undefined && eyebrow.length > 0 && (
            <EyebrowAtom as='p' variant='chip'>
              {eyebrow}
            </EyebrowAtom>
          )}
          <h1 className={styles.title}>{title}</h1>
          {subtitle !== undefined && subtitle !== null && (
            <p className={styles.subtitle}>{subtitle}</p>
          )}
        </div>
        {(actions !== undefined && actions !== null) ||
        (meta !== undefined && meta !== null) ? (
          <div className={styles.headerActions}>
            {actions !== undefined && actions !== null && (
              <div className={styles.actionsRow}>{actions}</div>
            )}
            {meta !== undefined && meta !== null && (
              <div className={styles.metaRow}>{meta}</div>
            )}
          </div>
        ) : null}
      </div>
    </header>
  );
}
