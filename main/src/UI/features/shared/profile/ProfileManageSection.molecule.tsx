// One section of a public-profile settings screen: a white box with its
// heading, an optional sentence on what it controls, then the fields.
import type { ReactNode } from 'react';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import styles from './ProfileManageSection.module.css';

export function ProfileManageSectionMolecule({
  id,
  title,
  description,
  meta,
  status,
  children,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  /** A short fact at the heading's end (a counter such as „3 z 30”). */
  meta?: ReactNode;
  /** The save line of a box that saves itself, under its fields. */
  status?: ReactNode;
  children: ReactNode;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={styles.section}
      data-app-section='bordered'>
      <div className={styles.head}>
        <div className={styles.titleRow}>
          <TypographyAtom
            variant='h4'
            as='h2'
            id={headingId}
            data-app-section-title=''>
            {title}
          </TypographyAtom>
          {meta != null && <span className={styles.meta}>{meta}</span>}
        </div>
        {description != null && (
          <TypographyAtom variant='body2' className={styles.description}>
            {description}
          </TypographyAtom>
        )}
      </div>
      {children}
      {status}
    </section>
  );
}
