// Prose only: we no longer write import Link from 'next/link' here.
const AppLinkAtom = (href: string): string => href;

export const used = AppLinkAtom('/blog');
