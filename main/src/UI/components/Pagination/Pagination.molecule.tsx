// UI/components/Pagination/Pagination.molecule.tsx
// The one pager. Two modes because the product has two kinds of lists:
//  • `pages`  — the server knows the total (page N of M, jump to a page);
//  • `cursor` — keyset lists that only know „there is more” (previous / next).
// It owns its previous/next glyphs („next” is the button primitive's forward
// arrow), so no call-site can put an arrow on the wrong side.
//
// WHY it exists (S126 census): six admin lists had five pagers (text links,
// numbered, outlined buttons with „Strona 1 z 2”, a size select with „1 / 1”,
// none). Copy stays with the caller (labels are props): this is a shared
// primitive and carries no namespace of its own.

import { CaretLeftIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../Button/Button.atom';
import styles from './Pagination.module.css';

interface PaginationBase {
  /** Accessible name of the navigation („Strony listy logów”). */
  ariaLabel: string;
  prevLabel: string;
  nextLabel: string;
  /** What the pager stands on, in words („Strona 2 z 14”, „50 na stronie”). */
  summary?: string;
  /** A page is loading: both directions wait. */
  isBusy?: boolean;
  className?: string;
}

interface PagesPagination extends PaginationBase {
  mode: 'pages';
  /** 1-based. */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Accessible name of a numbered button. */
  pageLabel: (page: number) => string;
}

interface CursorPagination extends PaginationBase {
  mode: 'cursor';
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export type PaginationProps = PagesPagination | CursorPagination;

/** First, last and the neighbours of the current page; `null` = a gap. */
export function pageWindow(page: number, pageCount: number): (number | null)[] {
  const wanted = new Set(
    [1, pageCount, page - 1, page, page + 1].filter(
      n => n >= 1 && n <= pageCount
    )
  );
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((n, index) => {
    const prev = sorted[index - 1];
    if (prev !== undefined && n - prev > 1) {
      out.push(null);
    }
    out.push(n);
  });
  return out;
}

export function PaginationMolecule(props: PaginationProps) {
  const { ariaLabel, prevLabel, nextLabel, summary, isBusy = false } = props;
  const hasPrev = props.mode === 'pages' ? props.page > 1 : props.hasPrev;
  const hasNext =
    props.mode === 'pages' ? props.page < props.pageCount : props.hasNext;

  // Nothing to page through: no dead controls under a one-page list.
  if (!hasPrev && !hasNext && summary === undefined) {
    return null;
  }

  const goPrev = () =>
    props.mode === 'pages'
      ? props.onPageChange(props.page - 1)
      : props.onPrev();
  const goNext = () =>
    props.mode === 'pages'
      ? props.onPageChange(props.page + 1)
      : props.onNext();

  return (
    <nav
      aria-label={ariaLabel}
      className={`${styles.pagination}${props.className ? ` ${props.className}` : ''}`}>
      {summary !== undefined && (
        <p className={styles.summary} aria-live='polite'>
          {summary}
        </p>
      )}
      <div className={styles.controls}>
        {/* The label hides on a narrow pager (CSS), so the name is set here. */}
        <ButtonAtom
          size='sm'
          variant='outlined'
          className={styles.step}
          icon={<CaretLeftIcon size={14} weight='bold' />}
          ariaLabel={prevLabel}
          disabled={!hasPrev || isBusy}
          onClick={goPrev}>
          <span className={styles.stepLabel}>{prevLabel}</span>
        </ButtonAtom>
        {props.mode === 'pages' && props.pageCount > 1 && (
          <ol className={styles.pages}>
            {pageWindow(props.page, props.pageCount).map((n, index, all) =>
              n === null ? (
                <li
                  key={`gap-after-${all[index - 1] ?? 0}`}
                  className={styles.gap}
                  aria-hidden='true'>
                  …
                </li>
              ) : (
                <li key={n}>
                  <button
                    type='button'
                    className={styles.page}
                    aria-label={props.pageLabel(n)}
                    aria-current={n === props.page ? 'page' : undefined}
                    disabled={isBusy}
                    onClick={() => props.onPageChange(n)}>
                    {n}
                  </button>
                </li>
              )
            )}
          </ol>
        )}
        <ButtonAtom
          size='sm'
          variant='outlined'
          direction='forward'
          className={styles.step}
          ariaLabel={nextLabel}
          disabled={!hasNext || isBusy}
          onClick={goNext}>
          <span className={styles.stepLabel}>{nextLabel}</span>
        </ButtonAtom>
      </div>
    </nav>
  );
}
