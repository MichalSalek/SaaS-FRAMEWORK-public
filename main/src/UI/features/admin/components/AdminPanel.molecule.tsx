// UI/features/admin/components/AdminPanel.molecule.tsx
// The frame around a list or a group of settings on an admin page: ONE white box on paper, a title
// row (title, an optional right end: a scope, a verdict, a count), an optional quiet line under it,
// then the content, then an optional footer row.
//
// WHY it exists: admin pages each drew this frame with their own header classes (icon sizes 14 and
// 16, three paddings, hairline or not). It is the same frame as „Wymaga reakcji” (AdminAttentionPanel):
// no leading icon in the title, so no icon to sit off its text's line.
//
// PROPS (shared by several admin pages: keep stable, add only optional ones): `title` (the <h2>),
// `aside` (right end of the title row, ONE unbreakable piece), `note` (a quiet line under the title
// row), `footer` (a note left, an action right), `children` (the content: a `surface='flush'`
// DataTable or a list of rows). The box has its own padding; content must not bring a second box.

import { useId, type ReactNode } from 'react';
import { KeepTogetherTextAtom } from '../../../components/KeepTogetherText/KeepTogetherText.atom';
import styles from './AdminPanel.module.css';

interface AdminPanelProps {
  title: ReactNode;
  /** Right end of the title row; stays on the title's centre line. */
  aside?: ReactNode;
  /** One quiet line under the title row. */
  note?: ReactNode;
  /** Under the content: a note on the left, an action on the right. */
  footer?: ReactNode;
  children: ReactNode;
}

export function AdminPanelMolecule({
  title,
  aside,
  note,
  footer,
  children,
}: AdminPanelProps) {
  // The title names the region: without the link a `<section>` is an
  // anonymous box to a screen reader.
  const titleId = useId();
  return (
    <section
      className={styles.panel}
      aria-labelledby={titleId}
      data-app-section='plain'>
      <header className={styles.header}>
        <h2 className={styles.title} id={titleId} data-app-section-title=''>
          {title}
        </h2>
        {aside !== undefined && <span className={styles.aside}>{aside}</span>}
      </header>
      {note !== undefined && (
        <p className={styles.note}>
          {typeof note === 'string' ? (
            <KeepTogetherTextAtom>{note}</KeepTogetherTextAtom>
          ) : (
            note
          )}
        </p>
      )}
      {children}
      {footer !== undefined && (
        <footer className={styles.footer}>{footer}</footer>
      )}
    </section>
  );
}
