import type { ElementType, ReactNode } from 'react';
import clsx from 'clsx';
import styles from './Section.module.css';

type SectionTone = 'plain' | 'subtle' | 'white';

export interface SectionProps {
  /**
   * plain  — page background (no band), only rhythm and container.
   * subtle — full-width band on --color-bg-subtle (gold tint 7%)
   *          with a MANDATORY full hairline frame top+bottom.
   */
  tone?: SectionTone;
  /**
   * Hairline top+bottom. Default: true for 'subtle' (owner: a tint without
   * a frame bleeds into the white), false for 'plain'.
   */
  bordered?: boolean;
  /** Section element (section/div/aside). Default: section. */
  as?: ElementType;
  /** false = inner without max-width (rare; default caps it to the LP width). */
  constrained?: boolean;
  /** false when the parent already supplies the complete page width. */
  fullBleed?: boolean;
  id?: string;
  className?: string;
  innerClassName?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  children: ReactNode;
}

/**
 * Section — LP section composition (full-bleed band + content container).
 *
 * DECISION: the systemic answer to "border flowers" (sections with border-top without
 * border-bottom, tints without a frame, a hand-copied 100vw breakout). A section on bg-subtle gets
 * out of the box: tint + FULL hairline frame + breakout + a centered --lp-content-width
 * container. The page supplies only content (header + grid). Do NOT copy `width:100vw;
 * margin-left:calc(50% - 50vw)` per section: use Section. The breakout counts 100vw, so the
 * layout's .content (PublicLayout) needs `overflow-x: clip` against horizontal scroll on classic
 * scrollbars. (owner)
 */
export function SectionComposition({
  tone = 'plain',
  bordered = tone === 'subtle',
  as: Tag = 'section',
  constrained = true,
  fullBleed = true,
  id,
  className,
  innerClassName,
  children,
  ...aria
}: SectionProps) {
  return (
    <Tag
      id={id}
      className={clsx(
        styles.band,
        fullBleed && styles.fullBleed,
        tone === 'subtle' && styles.toneSubtle,
        tone === 'white' && styles.toneWhite,
        bordered && styles.bordered,
        className
      )}
      aria-label={aria['aria-label']}
      aria-labelledby={aria['aria-labelledby']}>
      <div
        className={clsx(
          styles.inner,
          constrained && styles.constrained,
          innerClassName
        )}>
        {children}
      </div>
    </Tag>
  );
}
