// UI/features/shared/legal/legal-link-chunks.helpers.tsx
//
// The `<terms>` and `<privacy>` chunks of every „continuing accepts the terms”
// line (login, onboarding, second-role activation; owner). One
// place, so the three lines open the documents the same way: a new tab, no
// prefetch.

import type { ReactNode } from 'react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AppLinkAtom } from '../../../components/AppLink/AppLink.atom';

type RichChunk = (chunks: ReactNode) => ReactNode;

export function legalLinkChunks(linkClassName: string): {
  terms: RichChunk;
  privacy: RichChunk;
} {
  const link =
    (href: string): RichChunk =>
    chunks => (
      <AppLinkAtom
        prefetch={false}
        href={href}
        className={linkClassName}
        target='_blank'
        rel='noopener noreferrer'>
        {chunks}
      </AppLinkAtom>
    );
  return {
    terms: link(ROUTES_FRONT.TERMS),
    privacy: link(ROUTES_FRONT.PRIVACY),
  };
}
