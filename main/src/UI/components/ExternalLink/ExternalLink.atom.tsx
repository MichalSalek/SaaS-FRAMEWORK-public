import type { ReactNode, AnchorHTMLAttributes } from 'react';
import { openExternalUrl } from '../../../application/platform/browser';

type Props = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'target' | 'onClick'
> & {
  href: string;
  children: ReactNode;
};

export function ExternalLinkAtom({ href, children, ...rest }: Props) {
  return (
    <a
      {...rest}
      href={href}
      rel='noopener noreferrer'
      onClick={e => {
        e.preventDefault();
        void openExternalUrl(href);
      }}>
      {children}
    </a>
  );
}
