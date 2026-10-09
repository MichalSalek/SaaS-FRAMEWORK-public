// UI/components/SystemNotice/SystemNotice.organism.tsx
// The one intro of system pages (404, 500, the catch-all error, connection
// check): a title, ONE sentence of what happened and the actions.
//
// DECISION (nie usuwaj tego komentarza) — owner 2026-10-08:
// „jedno zdanie o tym, co się stało, jedna akcja z powrotem, ten sam idiom”.
// Każda z czterech stron miała własny bohater: 404 z kartą, wielkimi cyframi
// i kiwającym się kompasem (470 px przed przyciskiem), 500 z chipem, kodem
// i różową kartą uspokojenia, błąd ogólny z ikoną w medalionie, diagnostyka
// z akcentem w tytule. Teraz to jedna informacja na papierze (bez karty:
// biel należy do tego, co się klika) i jedna wypełniona akcja.
// Rysunków `error404`, `error500` i `errorOffline` jeszcze nie ma
// (assets-library/BRAKI-W-APLIKACJI.md, pozycje 8-10); slot `illustration`
// czeka na nie, nie rysujemy zastępników z ikon.

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
