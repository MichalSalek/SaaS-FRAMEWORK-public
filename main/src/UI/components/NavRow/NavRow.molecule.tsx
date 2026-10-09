import {
  createContext,
  useContext,
  useId,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { CaretRightIcon } from '@phosphor-icons/react';
import clsx from 'clsx';
import { AppLinkAtom } from '../AppLink/AppLink.atom';
import { ExternalLinkAtom } from '../ExternalLink/ExternalLink.atom';
import { SkeletonAtom } from '../Skeleton/Skeleton.atom';
import { AffordanceDiscAtom } from '../AffordanceDisc/AffordanceDisc.atom';
import styles from './NavRow.module.css';

type NavRowDensity = 'comfortable' | 'compact';
type NavRowSurface = 'paper' | 'nav';

interface NavRowListContextValue {
  density: NavRowDensity;
  surface: NavRowSurface;
}

/** Set by NavRowListMolecule: a row inside a list inherits its look and wraps
 *  itself in the `<li>`, so rows may come from nested components or fragments. */
const NavRowListContext = createContext<NavRowListContextValue | null>(null);

const BADGE_CAP = 99;

/** `tel:`, `mailto:` and in-page anchors are not pages: AppLinkAtom would
 *  treat them as one (and add a trailing slash). */
const PLAIN_ANCHOR_HREF = /^(tel:|mailto:|#)/;

export interface NavRowProps {
  /** Internal page href (rendered through AppLinkAtom). Without it the row is
   *  a `<button type='button'>` driven by `onClick`. With NEITHER `href` nor
   *  `onClick` the row is static: a plain `<div>` with the same anatomy, no
   *  hover, no pressed state and no trailing affordance (a finished checklist
   *  step, an inactive account). */
  href?: string;
  /** With `href`: another site, opened through `ExternalLinkAtom` (the in-app
   *  browser in the native shell; a `target='_blank'` loses the session
   *  there). `onClick` is not called for an external row. */
  external?: boolean;
  /** Also together with `href` (a `tel:` row that reveals the number first). */
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  icon?: ReactNode;
  /** Replaces the icon box with something larger, centred on the row the same
   *  way: a 40px `AvatarAtom` for a row about a person. Wins over `icon`. */
  leading?: ReactNode;
  /** May wrap to two lines: the row grows, the label is never truncated. */
  label: string;
  /** One line, cut with an ellipsis. */
  description?: string;
  /** A third line under the description: a hint sentence that may wrap, or a
   *  status line (a pill and a date). On a STATIC row it may hold an action
   *  (a small button, a dialog trigger); on a tappable row nothing interactive
   *  may go in: it would sit inside the row's link. */
  note?: ReactNode;
  /** Rendered when `count` > 0; above 99 shows „99+”. */
  badge?: { count: number; ariaLabel: string };
  /** `'disc'` = AffordanceDiscAtom, for tappable content rows; NEVER inside a
   *  navigation menu (menus use `'chevron'` or nothing). Ignored on a static
   *  row: what cannot be tapped does not promise a destination. */
  trailing?: 'disc' | 'chevron' | 'none';
  /** Current page: sets `aria-current='page'` and the selected look
   *  (inverted ink). Ignored on a static row. */
  active?: boolean;
  tone?: 'default' | 'danger';
  density?: NavRowDensity;
  /** `'nav'` = the row sits on a nav-coloured panel (`--color-nav-*`). */
  surface?: NavRowSurface;
  /** ONE second control of the cell (a row menu, an icon button), rendered as
   *  a SIBLING of the row's link or button, never inside it; works on a static
   *  row too. With `end` leave `trailing` at `'none'`. */
  end?: ReactNode;
  /** Accessible name of the row when the visible text is not enough. */
  ariaLabel?: string;
}

/**
 * The one tappable row of the product: navigation menus, settings lists and
 * "where next" lists. One look (DECISION in NavRow.module.css: grouped cells);
 * density, surface, tone and state live there on `data-*` attributes.
 */
export function NavRowMolecule({
  href,
  external = false,
  onClick,
  icon,
  leading,
  label,
  description,
  note,
  badge,
  trailing = 'none',
  active = false,
  tone = 'default',
  density,
  surface,
  end,
  ariaLabel,
}: NavRowProps) {
  const list = useContext(NavRowListContext);
  const rowDensity = density ?? list?.density ?? 'comfortable';

  const isStatic = href === undefined && onClick === undefined;

  const look = {
    'data-density': rowDensity,
    'data-surface': surface ?? list?.surface ?? 'paper',
    'data-tone': tone,
    // A label alone may wrap (German): its icon then stays on the FIRST line.
    // With a description or a note the icon is centred on the block, and a
    // leading avatar is always centred on the row.
    'data-align':
      description === undefined && note === undefined && leading === undefined
        ? 'first-line'
        : 'block',
    ...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {}),
  };
  const interactive = {
    ...look,
    // `haptic-press` = the light native haptic on press (one global listener,
    // application/platform/haptic-press-listener.ts). The class's own press
    // scale is switched off in the module: a cell of a list must not shrink.
    className: clsx(styles.row, styles.interactive, 'haptic-press'),
    ...(active
      ? { 'data-active': 'true', 'aria-current': 'page' as const }
      : {}),
  };
  const shared = { ...interactive, ...(onClick ? { onClick } : {}) };

  const content = (
    <>
      {leading !== undefined && (
        <span className={styles.leading}>{leading}</span>
      )}
      {leading === undefined && icon !== undefined && (
        <span className={styles.icon} aria-hidden='true'>
          {icon}
        </span>
      )}
      <span className={styles.body}>
        <span className={styles.label}>{label}</span>
        {description !== undefined && (
          <span className={styles.description}>{description}</span>
        )}
        {note !== undefined && <span className={styles.note}>{note}</span>}
      </span>
      {badge !== undefined && badge.count > 0 && (
        <span className={styles.badge} aria-label={badge.ariaLabel}>
          {badge.count > BADGE_CAP ? `${String(BADGE_CAP)}+` : badge.count}
        </span>
      )}
      {!isStatic && trailing === 'chevron' && (
        <span className={styles.chevron} aria-hidden='true'>
          <CaretRightIcon size={16} />
        </span>
      )}
      {!isStatic && trailing === 'disc' && (
        <AffordanceDiscAtom size={rowDensity === 'compact' ? 'sm' : 'md'} />
      )}
    </>
  );

  let row: ReactNode;
  if (isStatic) {
    row = (
      <div className={styles.row} {...look}>
        {content}
      </div>
    );
  } else if (href === undefined) {
    row = (
      <button type='button' {...shared}>
        {content}
      </button>
    );
  } else if (external) {
    row = (
      <ExternalLinkAtom href={href} {...interactive}>
        {content}
      </ExternalLinkAtom>
    );
  } else if (PLAIN_ANCHOR_HREF.test(href)) {
    row = (
      <a href={href} {...shared}>
        {content}
      </a>
    );
  } else {
    row = (
      <AppLinkAtom href={href} {...shared}>
        {content}
      </AppLinkAtom>
    );
  }

  const cell =
    end === undefined ? (
      row
    ) : (
      <>
        {row}
        <span className={styles.end}>{end}</span>
      </>
    );
  if (list !== null) {
    return <li className={styles.item}>{cell}</li>;
  }
  // Outside a list a row with a second control still needs its cell.
  return end === undefined ? row : <div className={styles.item}>{cell}</div>;
}

export interface NavRowListProps {
  /** Visible group label above the rows (also names the list). */
  label?: string;
  children: ReactNode;
  density?: NavRowDensity;
  surface?: NavRowSurface;
  /** Name of the list when it has no visible `label`. */
  ariaLabel?: string;
}

/**
 * One group of rows. Sibling groups space themselves; a danger row gets its own
 * single-row group (the consumer splits it out), so it never shares a box.
 */
export function NavRowListMolecule({
  label,
  children,
  density = 'comfortable',
  surface = 'paper',
  ariaLabel,
}: NavRowListProps) {
  const labelId = useId();
  return (
    <div className={styles.group} data-density={density} data-surface={surface}>
      {label !== undefined && (
        <p className={styles.groupLabel} id={labelId}>
          {label}
        </p>
      )}
      <ul
        className={styles.list}
        {...(label !== undefined
          ? { 'aria-labelledby': labelId }
          : ariaLabel !== undefined
            ? { 'aria-label': ariaLabel }
            : {})}>
        <NavRowListContext.Provider value={{ density, surface }}>
          {children}
        </NavRowListContext.Provider>
      </ul>
    </div>
  );
}

export interface NavRowListSkeletonProps {
  rows?: number;
  /** The rows will carry a 40px avatar in `leading`. */
  leading?: boolean;
  /** Text lines of a row: label, + description, + note. */
  lines?: 1 | 2 | 3;
  density?: NavRowDensity;
  surface?: NavRowSurface;
}

const SKELETON_LINE_WIDTHS = ['46%', '30%', '38%'] as const;

/**
 * The loading stand-in of a `NavRowListMolecule`: the SAME box, cells and row
 * geometry (it is built from the row's own classes), so its height equals the
 * loaded list's by construction, never by a number someone guessed.
 */
export function NavRowListSkeletonMolecule({
  rows = 3,
  leading = false,
  lines = 2,
  density = 'comfortable',
  surface = 'paper',
}: NavRowListSkeletonProps) {
  const lineClasses = [styles.label, styles.description, styles.note];
  return (
    <div
      className={styles.group}
      data-density={density}
      data-surface={surface}
      aria-hidden='true'>
      <ul className={styles.list}>
        {Array.from({ length: rows }, (_, row) => (
          <li key={row} className={styles.item}>
            <div
              className={styles.row}
              data-density={density}
              data-surface={surface}
              data-tone='default'
              data-align='block'>
              {leading && (
                <span className={styles.leading}>
                  <SkeletonAtom variant='circle' width={40} height={40} />
                </span>
              )}
              <span className={styles.body}>
                {lineClasses.slice(0, lines).map((lineClass, line) => (
                  <span key={line} className={lineClass}>
                    <SkeletonAtom
                      variant='text'
                      width={SKELETON_LINE_WIDTHS[line] ?? '30%'}
                      className={styles.skeletonLine}
                    />
                  </span>
                ))}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
