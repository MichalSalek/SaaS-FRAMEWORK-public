import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import NextLink from 'next/link';
import { withPageTrailingSlash } from '../../../application/routing/page-href';

type NextLinkProps = ComponentPropsWithoutRef<typeof NextLink>;
type Href = NextLinkProps['href'];

function canonicalHref(href: Href): Href {
  if (typeof href === 'string') {
    return withPageTrailingSlash(href);
  }
  if (typeof href.pathname === 'string') {
    return { ...href, pathname: withPageTrailingSlash(href.pathname) };
  }
  return href;
}

/**
 * next/link with canonical trailing-slash hrefs for internal pages (why:
 * application/routing/page-href.ts). Same props and ref as next/link; the only
 * change is the rendered href, so crawlers follow links straight to the
 * canonical URL instead of through a 301.
 */
export const AppLinkAtom = forwardRef<HTMLAnchorElement, NextLinkProps>(
  function AppLinkAtom({ href, as, ...rest }, ref) {
    return (
      <NextLink
        ref={ref}
        href={canonicalHref(href)}
        {...(as === undefined ? {} : { as: canonicalHref(as) })}
        {...rest}
      />
    );
  }
);
