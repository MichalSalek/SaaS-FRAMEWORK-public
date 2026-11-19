// UI/components/SystemNotice/SystemNotice.organism.tsx
// The one intro of system pages (404, 500, the catch-all error, connection
// check): a title, ONE sentence of what happened and the actions.
//
// DECISION: one sentence about what happened, one action back, the same idiom. Each of the four
// pages used to have its own hero (404 with a card, giant digits and a swaying compass; 500 with a
// chip, a code and a pink reassurance card; the catch-all error with an icon in a medallion;
// diagnostics with an accented title). Now it is one piece of information on paper (no card: white
// belongs to what is clicked) and one filled action. The drawings `error404`, `error500` and
// `errorOffline` do not exist yet; the `illustration` slot waits for them, no icon stand-ins are
// drawn. (owner)

import type { ReactNode } from 'react';
import styles from './SystemNotice.module.css';

interface SystemNoticeProps {
  /** id of the <h1>, referenced by the section's aria-labelledby. */
  titleId: string;
  title: ReactNode;
  /** One sentence of what happened. */
  body: ReactNode;
  /** The one filled action first, at most one `outlined` next to it. */
  actions: ReactNode;
  /** A drawing above the title, once the asset exists. */
  illustration?: ReactNode;
  /** A quiet line under the actions (an error code, a timestamp). */
  meta?: ReactNode;
}

export function SystemNoticeOrganism({
  titleId,
  title,
  body,
  actions,
  illustration,
  meta,
}: SystemNoticeProps) {
  return (
    <section className={styles.notice} aria-labelledby={titleId}>
      {illustration !== undefined && (
        <div className={styles.illustration}>{illustration}</div>
      )}
      <h1 id={titleId} className={styles.title}>
        {title}
      </h1>
      <div className={styles.body}>{body}</div>
      <div className={styles.actions}>{actions}</div>
      {meta !== undefined && <div className={styles.meta}>{meta}</div>}
    </section>
  );
}
