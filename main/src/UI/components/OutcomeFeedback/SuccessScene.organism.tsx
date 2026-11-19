import { useId, useRef, useEffect, type ReactNode } from 'react';
import clsx from 'clsx';
import { CheckIcon } from '@phosphor-icons/react';
import { useIsUnderAppBar } from '../AppHero/appHeroVisibility';
import styles from './OutcomeFeedback.module.css';

export type SuccessPresentation = 'plain' | 'glory';

export interface SuccessSceneProps {
  title: ReactNode;
  body?: ReactNode;
  preview?: ReactNode;
  actions: ReactNode;
  aside?: ReactNode;
  firstTime?: boolean;
  titleId?: string;
  titleAs?: 'h1' | 'h2';
  className?: string;
  /**
   * `glory` is a milestone (onboarding, first photo, plan active): a compact
   * brand band with the check and the title, then a paper panel for the content.
   * `plain` keeps the existing success scene on its host surface (magic link,
   * invitation, repeated upload). (owner)
   */
  presentation?: SuccessPresentation;
  /**
   * Docks the action stack to the bottom of the scene. Use it on full-screen
   * successes so the main button stays under the thumb also when the content is
   * shorter than the screen; long content scrolls while the dock stays put.
   */
  actionDock?: boolean;
}

export const SuccessSceneOrganism = ({
  title,
  body,
  preview,
  actions,
  aside,
  firstTime = false,
  titleId,
  titleAs,
  className,
  presentation = 'plain',
  actionDock = false,
}: SuccessSceneProps) => {
  const underAppBar = useIsUnderAppBar();
  const Title = titleAs ?? (underAppBar ? 'h2' : 'h1');
  const generatedId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  const heading = (
    <Title
      ref={titleRef}
      tabIndex={-1}
      id={titleId ?? generatedId}
      className={styles.title}>
      {title}
    </Title>
  );

  const emblem = (
    <div className={styles.emblem} aria-hidden='true'>
      <CheckIcon weight='bold' />
      {firstTime &&
        Array.from({ length: 6 }, (_, index) => (
          <i key={index} className={styles.particle} data-position={index} />
        ))}
    </div>
  );

  const actionStack = (
    <div
      className={clsx(
        styles.actionsDockSlot,
        actionDock && styles.actionsDocked
      )}>
      <div className={styles.actions}>{actions}</div>
    </div>
  );

  if (presentation === 'glory') {
    return (
      <section
        aria-labelledby={titleId ?? generatedId}
        data-app-section-exclude=''
        className={clsx(styles.scene, styles.sceneGlory, className)}
        data-presentation='glory'>
        <div className={styles.gloryBand}>
          {emblem}
          {heading}
        </div>
        <div className={styles.gloryPanel}>
          {body != null && <div className={styles.body}>{body}</div>}
          {preview != null && <div className={styles.preview}>{preview}</div>}
          {aside != null && <div className={styles.aside}>{aside}</div>}
          {actionStack}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={titleId ?? generatedId}
      data-app-section-exclude=''
      className={clsx(
        styles.scene,
        actionDock && styles.sceneDocked,
        className
      )}
      data-presentation='plain'>
      {emblem}
      {heading}
      {body != null && <div className={styles.body}>{body}</div>}
      {preview != null && <div className={styles.preview}>{preview}</div>}
      {actionDock ? (
        <>
          {aside != null && <div className={styles.aside}>{aside}</div>}
          {actionStack}
        </>
      ) : (
        <>
          <div className={styles.actions}>{actions}</div>
          {aside != null && <div className={styles.aside}>{aside}</div>}
        </>
      )}
    </section>
  );
};
