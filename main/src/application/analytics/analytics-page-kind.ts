import { I18N_CONFIG } from '@kernel/domain/i18n/i18n.config';

export type PageKind =
  | 'home'
  | 'stylists'
  | 'studios'
  | 'clients'
  | 'pricing'
  | 'compare'
  | 'about'
  | 'blog'
  | 'help'
  | 'get-app'
  | 'contact'
  | 'other';

const PAGE_KIND_BY_PATH: ReadonlyArray<readonly [string, PageKind]> = [
  ['/for-stylists', 'stylists'],
  ['/for-studios', 'studios'],
  ['/for-clients', 'clients'],
  ['/pricing', 'pricing'],
  ['/compare', 'compare'],
  ['/about', 'about'],
  ['/blog', 'blog'],
  ['/help-center', 'help'],
  ['/help', 'help'],
  ['/get-app', 'get-app'],
  ['/contact', 'contact'],
];

function stripLocalePrefix(pathname: string): string {
  for (const locale of I18N_CONFIG.locales) {
    if (pathname === `/${locale}`) {
      return '/';
    }
    if (pathname.startsWith(`/${locale}/`)) {
      return pathname.slice(locale.length + 1);
    }
  }
  return pathname;
}

export function resolvePageKind(pathname: string): PageKind {
  const path = stripLocalePrefix(pathname);
  if (path === '/') {
    return 'home';
  }
  const hit = PAGE_KIND_BY_PATH.find(([prefix]) => path.startsWith(prefix));
  return hit ? hit[1] : 'other';
}
