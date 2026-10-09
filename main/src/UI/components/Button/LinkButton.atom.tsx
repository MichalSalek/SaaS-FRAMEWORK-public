import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';
import type { ButtonVariant, ButtonSize, ButtonDirection } from './Button.atom';
import { buttonClassName, ButtonInner } from './buttonCore';
import { openExternalUrl } from '../../../application/platform/browser';
import { AppLinkAtom as Link } from '../AppLink/AppLink.atom';

export interface LinkButtonProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'children'
> {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  /** Strona ikony — mirror Button (S28/4=D: forward CTA → 'right'). */
  /** Forward CTA: the primitive draws the arrow after the label (see Button). */
  direction?: ButtonDirection | undefined;
  children?: ReactNode;
  className?: string;
  /** Accessible label — required for icon-only links (no children). */
  ariaLabel?: string;
  /**
   * External destination (store, marketing site). Routed through
   * openExternalUrl, the single source of truth for native vs web (Capacitor
   * in-app browser inside the app, new tab on the web). The anchor never
   * carries target=_blank for an external href — that would break out of the
   * Capacitor WebView and kill the session. Mirrors ExternalLink.
   */
  external?: boolean;
}

/**
 * Anchor styled identically to <Button> (shares Button.module.css). Use for
 * CTAs that navigate (store links, external URLs). Pass `external` for
 * off-site destinations so they open safely in every shell.
 */
export function LinkButtonAtom({
  href,
  variant = 'primary',
  size = 'md',
  icon,
  direction,
  children,
  className,
  ariaLabel,
  external = false,
  onClick,
  target,
  rel,
  onMouseEnter,
  onTouchStart,
  ...rest
}: LinkButtonProps) {
  const isIconOnly = icon != null && children == null;

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) {
      return;
    }
    // External links ALWAYS go through openExternalUrl — the single native-vs-web
    // decision point (keyed off Capacitor.isNativePlatform()). Intercept
    // unconditionally so a raw navigation never breaks the Capacitor session.
    if (external) {
      e.preventDefault();
      void openExternalUrl(href);
    }
  };

  const inner = (
    <ButtonInner icon={icon} direction={direction}>
      {children}
    </ButtonInner>
  );
  const classes = buttonClassName({ variant, size, isIconOnly, className });

  // DECISION (nie usuwaj tego komentarza):
  // An internal href goes through AppLinkAtom (next/link), which adds the
  // current locale prefix and the canonical trailing slash. A plain <a> did
  // neither: on /en/ and /de/ pages „Log in” and every plan CTA pointed at
  // `/user/login`, which renders Polish (localeDetection: false), so an English
  // visitor from ChatGPT landed on a Polish login screen (measured 2026-09-23).
  if (!external && href.startsWith('/') && !href.startsWith('//')) {
    return (
      <Link
        {...rest}
        {...(onMouseEnter === undefined ? {} : { onMouseEnter })}
        {...(onTouchStart === undefined ? {} : { onTouchStart })}
        href={href}
        target={target}
        rel={rel}
        className={classes}
        aria-label={ariaLabel}
        onClick={handleClick}>
        {inner}
      </Link>
    );
  }

  return (
    <a
      {...rest}
      onMouseEnter={onMouseEnter}
      onTouchStart={onTouchStart}
      href={href}
      target={external ? undefined : target}
      rel={external ? 'noopener noreferrer' : rel}
      className={classes}
      aria-label={ariaLabel}
      onClick={handleClick}>
      {inner}
    </a>
  );
}
