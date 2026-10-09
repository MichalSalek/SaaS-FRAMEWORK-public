import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import clsx from 'clsx';
import { ArrowRightIcon } from '@phosphor-icons/react';
import { AppLinkAtom } from '../AppLink/AppLink.atom';
import { ExternalLinkAtom } from '../ExternalLink/ExternalLink.atom';
import styles from './AppParagraphLink.module.css';

export interface AppParagraphLinkProps extends Omit<
  ComponentPropsWithoutRef<typeof AppLinkAtom>,
  'href' | 'children'
> {
  href: string;
  children: ReactNode;
  external?: boolean;
  prefetch?: boolean;
}

/** Text navigation always carries an underline and the same forward icon. */
export function AppParagraphLinkAtom({
  href,
  children,
  className,
  external = false,
  prefetch,
  ...rest
}: AppParagraphLinkProps) {
  const content = (
    <>
      <span className={styles.label}>{children}</span>
      <ArrowRightIcon className={styles.arrow} aria-hidden='true' />
    </>
  );
  const linkClass = clsx(styles.link, className);
  return external ? (
    <ExternalLinkAtom href={href} className={linkClass} {...rest}>
      {content}
    </ExternalLinkAtom>
  ) : (
    <AppLinkAtom
      href={href}
      className={linkClass}
      {...(prefetch === undefined ? {} : { prefetch })}
      {...rest}>
      {content}
    </AppLinkAtom>
  );
}
