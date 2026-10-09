// UI/features/auth/DeleteSelfPage.parts.atom.tsx
// Presentational sub-part of DeleteSelfPage: the Note, plus the step type.
// The header (title + step indicator) is the shared ProcessHeaderMolecule.
// Lives next to the main page to respect the project-wide max-lines: 300 rule.

import styles from './DeleteSelfPage.module.css';

export type DeleteSelfStep = 'review' | 'confirm' | 'done';

/* ─── Note (a fact the person reads: title + one paragraph, on paper) ─── */

interface NoteProps {
  title: string;
  description: string;
}

export function DeleteSelfNoteAtom({ title, description }: NoteProps) {
  return (
    <section className={styles.note}>
      <h2 className={styles.noteTitle}>{title}</h2>
      <p className={styles.noteDescription}>{description}</p>
    </section>
  );
}
